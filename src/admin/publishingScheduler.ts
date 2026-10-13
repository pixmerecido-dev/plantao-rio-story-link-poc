import type {
  QueueJob,
  OperationsState,
  Health,
  PublicationConfirmation,
} from "./operationsDomain.js";
import { PublicationQueueService } from "./publicationQueueService.js";
import { PublishingPolicyService } from "./publishingPolicyService.js";
import { validateStickerText } from "./domain.js";
import { logEvent } from "./operationAudit.js";
export function orderedJobs(s: OperationsState) {
  const rank = { URGENT: 0, HIGH: 1, NORMAL: 2 };
  return s.queue
    .filter((j) => ["QUEUED", "SCHEDULED"].includes(j.status))
    .sort(
      (a, b) =>
        rank[a.priority] - rank[b.priority] ||
        a.order - b.order ||
        a.created_at.localeCompare(b.created_at),
    );
}
export interface PublishingAdapter {
  execute(job: QueueJob): Promise<{
    status: "SUCCESS" | "FAILED" | "INCONCLUSIVE";
    publish_clicked: boolean | null;
    published_at?: string;
    error?: string;
    confirmation?: PublicationConfirmation;
  }>;
}
export class PublishingScheduler {
  private running = false;
  constructor(
    private queue: PublicationQueueService,
    private policy: PublishingPolicyService,
    private adapter?: PublishingAdapter,
  ) {}
  async inspect(now: Date, health: Health[]) {
    const s = await this.queue.store.read();
    return orderedJobs(s).map((job) => ({
      job_id: job.id,
      priority: job.priority,
      decision: this.policy.canPublish(job, now, s, health),
    }));
  }
  async claim(now: Date, health: Health[]) {
    return this.queue.store.transact((s) => {
      if (
        s.safety.pause_on_system_failure &&
        health.some((h) => h.status === "OFFLINE" || h.status === "DEGRADED")
      ) {
        if (s.system.status === "ONLINE") {
          s.system = {
            status: "PAUSED",
            reason: "Health check indisponível; jobs preservados na fila.",
          };
          logEvent(s, "system", "PAUSED", s.system.reason!);
        }
        return null;
      }
      const j = orderedJobs(s).find(
        (j) => this.policy.canPublish(j, now, s, health).allowed,
      );
      if (!j) return null;
      const settings = s.account_settings[j.account_id];
      if (
        !settings?.publishing.instagram_enabled ||
        !settings.story.sticker.enabled
      )
        return null;
      const sticker = settings.story.sticker;
      try {
        validateStickerText(j.sticker_text, sticker.max_text_length);
      } catch (error) {
        j.status = "REQUIRES_REVIEW";
        j.error_code = "STICKER_TEXT_LIMIT";
        j.error_message = String((error as Error).message);
        logEvent(s, j.job_id, "REQUIRES_REVIEW", j.error_message);
        return null;
      }
      j.effective_settings = {
        account_id: j.account_id,
        sticker_text: j.sticker_text,
        sticker_style_index: sticker.style_index,
        max_text_length: sticker.max_text_length,
        sticker_scale: sticker.scale,
        sticker_x_pct: sticker.x_pct,
        sticker_y_pct: sticker.y_pct,
        facebook_enabled: settings.publishing.facebook_enabled,
        instagram_enabled: true,
        require_link_confirmation: true,
        require_layout_confirmation: true,
        abort_on_layout_failure: true,
      };
      j.status = "PREPARING";
      j.started_at = now.toISOString();
      j.attempts++;
      j.instagram_username = s.instagram_accounts.find(
        (a) => a.id === j.account_id,
      )!.detected_username;
      j.attempt_history.push({
        number: j.attempts,
        started_at: j.started_at,
        finished_at: null,
        outcome: null,
        publish_clicked: false,
      });
      s.locks[j.account_id] = { job_id: j.id, acquired_at: j.started_at };
      logEvent(
        s,
        j.job_id,
        "JOB_STARTED",
        "Configuração congelada; lock exclusivo por conta adquirido.",
      );
      return j;
    });
  }
  async tick(now: Date, health: Health[]) {
    if (this.running) return { started: false, reason: "SCHEDULER_BUSY" };
    if (!this.adapter) {
      await this.queue.store.transact((s) => {
        if (
          s.safety.pause_on_system_failure &&
          s.system.status === "ONLINE" &&
          health.some((h) => h.status === "OFFLINE" || h.status === "DEGRADED")
        ) {
          s.system = { status: "PAUSED", reason: "Health check indisponível." };
          logEvent(s, "system", "PAUSED", s.system.reason!);
        }
      });
      return { started: false, reason: "ENGINE_ADAPTER_NOT_CONNECTED" };
    }
    this.running = true;
    try {
      const job = await this.claim(now, health);
      if (!job) return { started: false, reason: "NO_ELIGIBLE_JOB" };
      try {
        const result = await this.adapter.execute(job);
        await this.queue.finish(job.id, result.status, result);
      } catch {
        await this.queue.finish(job.id, "INCONCLUSIVE", {
          publish_clicked: null,
          error:
            "Adapter interrompido; publicação pode ter ocorrido. Revisão obrigatória.",
        });
      }
      return { started: true, job_id: job.id };
    } finally {
      this.running = false;
    }
  }
}
