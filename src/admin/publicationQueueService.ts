import { articleIdentity } from "../ingestion/feedDomain.js";
import { randomUUID } from "node:crypto";
import { resolveStoryMedia } from "../media/resolveStoryMedia.js";
import {
  ValidationError,
  validateSettings,
  validateStickerText,
} from "./domain.js";
import {
  validateAutomation,
  type QueueJob,
  type PublicationConfirmation,
  type Priority,
  type JobMode,
} from "./operationsDomain.js";
import type { OperationsRepository } from "./operationsStorage.js";
import { DeduplicationService } from "./deduplicationService.js";
import { audit, logEvent, nowISO } from "./operationAudit.js";
export class PublicationQueueService {
  constructor(public store: OperationsRepository) {}
  async enqueueJob(input: {
    account_id: string;
    downloaded_media?: import("../media/downloadStoryMedia.js").DownloadedMedia;
    ready_only?: boolean;
    feed_entry_id?: string;
    media_path: string;
    story_url: string;
    sticker_text: string;
    priority?: Priority;
    mode?: JobMode;
    scheduled_at?: string | null;
  }) {
    if (
      typeof input.account_id !== "string" ||
      typeof input.story_url !== "string" ||
      typeof input.sticker_text !== "string" ||
      !input.sticker_text.trim()
    )
      throw new ValidationError("Conta, URL e texto obrigatórios.");
    let url: URL;
    try {
      url = new URL(input.story_url);
    } catch {
      throw new ValidationError("URL inválida.");
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new ValidationError("URL HTTP(S) sem credenciais obrigatória.");
    const priority = input.priority ?? "NORMAL",
      mode = input.mode ?? "AUTO_QUEUE";
    if (
      !["NORMAL", "HIGH", "URGENT"].includes(priority) ||
      !["IMMEDIATE", "SCHEDULED", "AUTO_QUEUE", "PAUSED"].includes(mode)
    )
      throw new ValidationError("Prioridade/modo inválido.");
    if (input.scheduled_at && !Number.isFinite(Date.parse(input.scheduled_at)))
      throw new ValidationError("Agendamento inválido.");
    if (mode === "SCHEDULED" && !input.scheduled_at)
      throw new ValidationError("Horário obrigatório.");
    const media = await resolveStoryMedia(input.media_path);
    if (media.type === "UNSUPPORTED" || media.size === 0)
      throw new ValidationError("Mídia local inválida.");
    if (
      input.downloaded_media &&
      (input.downloaded_media.local_media_path !== media.path ||
        input.downloaded_media.sha256 !== media.sha256 ||
        input.downloaded_media.file_size !== media.size ||
        input.downloaded_media.mime_type !== media.mimeType)
    )
      throw new ValidationError("Mídia baixada mudou antes da criação do job.");
    const timestamp = nowISO(),
      id = randomUUID(),
      key = DeduplicationService.key(
        input.account_id,
        input.story_url,
        media.sha256,
      );
    return this.store.transact((s) => {
      if (!s.instagram_accounts.some((a) => a.id === input.account_id))
        throw new ValidationError("Conta inexistente.");
      validateStickerText(
        input.sticker_text,
        s.account_settings[input.account_id]?.story.sticker.max_text_length ??
          null,
      );
      const entry = input.feed_entry_id
        ? s.feed.entries.find((e) => e.id === input.feed_entry_id)
        : undefined;
      if (
        input.feed_entry_id &&
        (!entry || entry.account_id !== input.account_id)
      )
        throw new ValidationError("Matéria RSS/conta inexistente.");
      if (entry?.job_id) {
        const existing = s.queue.find((j) => j.job_id === entry.job_id);
        if (!existing)
          throw new ValidationError("Job RSS ausente; revisão necessária.");
        return existing;
      }
      const priorArticleJob = entry
        ? s.queue.find(
            (j) =>
              articleIdentity(j.article_url ?? j.story_url) ===
              articleIdentity(entry.article_url!),
          )
        : undefined;
      if (entry && priorArticleJob) {
        entry.job_id = priorArticleJob.job_id;
        entry.status = "DUPLICATE";
        logEvent(
          s,
          priorArticleJob.job_id,
          "DUPLICATE_ARTICLE_SKIPPED",
          "Job existente reutilizado; duplicata bloqueada.",
          { article_url: entry.article_url, entry_id: entry.id },
        );
        return priorArticleJob;
      }
      if (entry && ["IGNORED", "DUPLICATE"].includes(entry.status))
        throw new ValidationError(
          "Matéria ignorada/duplicada não pode entrar na fila.",
        );
      if (
        entry &&
        (!entry.downloaded_media ||
          entry.downloaded_media.sha256 !== media.sha256 ||
          entry.article_url !== input.story_url)
      )
        throw new ValidationError(
          "Mídia/URL não corresponde à matéria validada.",
        );
      const duplicate = DeduplicationService.exists(s, key);
      const job: QueueJob = {
        id,
        job_id: id,
        account_id: input.account_id,
        instagram_username: null,
        ...(input.downloaded_media
          ? {
              downloaded_media: structuredClone(input.downloaded_media),
              source_media_url: input.downloaded_media.source_media_url,
              local_media_path: media.path,
              mime_type: media.mimeType,
              extension: input.downloaded_media.extension,
              file_size: media.size,
              sha256: media.sha256,
              downloaded_at: input.downloaded_media.downloaded_at,
            }
          : {}),
        ...(entry
          ? {
              ...(entry.article_title ? { article_title: entry.article_title } : {}),
              feed_entry_id: entry.id,
              article_url: entry.article_url!,
              detected_at: entry.detected_at,
              last_error: null,
            }
          : {}),
        media_path: media.path,
        media_type: media.type,
        media_filename: media.filename,
        media_hash: media.sha256,
        story_url: input.story_url,
        sticker_text: input.sticker_text,
        priority,
        mode,
        scheduled_at: input.scheduled_at ?? null,
        created_at: timestamp,
        started_at: null,
        finished_at: null,
        published_at: null,
        status: duplicate
          ? "DUPLICATE"
          : input.ready_only
            ? "READY"
            : mode === "PAUSED"
              ? "PAUSED"
              : mode === "SCHEDULED"
                ? "SCHEDULED"
                : "QUEUED",
        ...(input.ready_only ? { awaiting_operator: true } : {}),
        attempts: 0,
        duration_ms: null,
        error_code: null,
        error_message: null,
        dedup_key: key,
        order: Math.max(0, ...s.queue.map((j) => j.order)) + 1,
        effective_settings: null,
        facebook_crosspost: null,
        attempt_history: [],
      };
      s.queue.push(job);
      if (entry) {
        entry.job_id = job.job_id;
        entry.status = duplicate
          ? "DUPLICATE"
          : input.ready_only
            ? "READY"
            : "QUEUED";
        entry.updated_at = timestamp;
        entry.last_error = null;
        logEvent(
          s,
          job.job_id,
          duplicate ? "QUEUE_JOB_SKIPPED" : "QUEUE_JOB_CREATED",
          input.ready_only
            ? "Job READY criado na fila; aguardando operador."
            : "Ingestão RSS vinculada à fila.",
          {
            article_url: entry.article_url,
            media_url: entry.media_url,
            entry_id: entry.id,
            job_id: job.job_id,
          },
        );
      }
      logEvent(
        s,
        id,
        "JOB_CREATED",
        "Job local criado; nenhuma execução no Instagram.",
        input.downloaded_media ? { ...input.downloaded_media } : undefined,
      );
      if (duplicate)
        logEvent(
          s,
          id,
          "DUPLICATE_DETECTED",
          "Conta, URL e fingerprint já existentes.",
        );
      if (mode === "SCHEDULED")
        logEvent(s, id, "JOB_SCHEDULED", "Job agendado.", {
          scheduled_at: job.scheduled_at,
        });
      return job;
    });
  }
  async action(
    id: string,
    action:
      | "pause"
      | "resume"
      | "cancel"
      | "top"
      | "publish-now"
      | "schedule"
      | "enqueue"
      | "retry",
    scheduled_at?: string,
  ) {
    if (["retry", "enqueue", "schedule", "publish-now"].includes(action)) {
      const current = (await this.store.read()).queue.find((j) => j.id === id);
      if (!current) throw new ValidationError("Job não encontrado.");
      if (action === "retry" || current.awaiting_operator) {
        const media = await resolveStoryMedia(current.media_path);
        if (media.sha256 !== current.media_hash || media.type === "UNSUPPORTED")
          throw new ValidationError("Mídia local alterada; ação bloqueada.");
      }
    }
    return this.store.transact((s) => {
      const j = s.queue.find((j) => j.id === id);
      if (!j) throw new ValidationError("Job não encontrado.");
      const manualReady =
        j.status === "READY" &&
        j.awaiting_operator === true &&
        j.attempts === 0 &&
        !j.started_at;
      const safeRetry =
        action === "retry" &&
        j.status === "FAILED" &&
        j.attempts > 0 &&
        j.attempts < s.publishing.max_attempts &&
        j.attempt_history.length === j.attempts &&
        j.attempt_history.every(
          (a) => a.publish_clicked === false && !!a.finished_at,
        );
      if (
        !manualReady &&
        !safeRetry &&
        !["QUEUED", "SCHEDULED", "PAUSED"].includes(j.status)
      )
        throw new ValidationError(
          "Job em execução ou finalizado não pode ser alterado/republicado.",
        );
      if (action === "retry" && !safeRetry)
        throw new ValidationError(
          "Retry exige falha comprovadamente anterior ao envio; revisão obrigatória nos demais casos.",
        );
      if (["enqueue", "retry", "schedule", "publish-now"].includes(action))
        validateStickerText(
          j.sticker_text,
          s.account_settings[j.account_id]?.story.sticker.max_text_length ??
            null,
        );
      const before = structuredClone(j);
      if (action === "enqueue" || action === "retry") {
        j.status = "QUEUED";
        j.mode = "AUTO_QUEUE";
        j.awaiting_operator = false;
        j.scheduled_at = null;
        j.finished_at = null;
        j.started_at = null;
        j.error_code = null;
        j.error_message = null;
      }
      if (action === "pause") {
        j.status = "PAUSED";
        j.mode = "PAUSED";
      }
      if (action === "resume") {
        j.status = j.awaiting_operator
          ? "READY"
          : j.scheduled_at && Date.parse(j.scheduled_at) > Date.now()
            ? "SCHEDULED"
            : "QUEUED";
        j.mode = j.status === "SCHEDULED" ? "SCHEDULED" : "AUTO_QUEUE";
      }
      if (action === "cancel") {
        j.status = "CANCELLED";
        j.finished_at = nowISO();
      }
      if (action === "top") {
        j.order =
          Math.min(
            0,
            ...s.queue
              .filter((x) => x.priority === j.priority)
              .map((x) => x.order),
          ) - 1;
      }
      if (action === "publish-now") {
        j.status = "QUEUED";
        j.awaiting_operator = false;
        j.mode = "IMMEDIATE";
        j.scheduled_at = null;
      }
      if (action === "schedule") {
        if (!scheduled_at || !Number.isFinite(Date.parse(scheduled_at)))
          throw new ValidationError("Agendamento inválido.");
        j.status = "SCHEDULED";
        j.awaiting_operator = false;
        j.mode = "SCHEDULED";
        j.scheduled_at = scheduled_at;
      }
      if (j.feed_entry_id) {
        const entry = s.feed.entries.find((e) => e.id === j.feed_entry_id);
        if (entry) {
          entry.status =
            j.status === "READY"
              ? "READY"
              : action === "cancel"
                ? "IGNORED"
                : "QUEUED";
          entry.updated_at = nowISO();
        }
      }
      audit(
        s,
        `queue.${id}.${action}`,
        {
          status: before.status,
          mode: before.mode,
          scheduled_at: before.scheduled_at,
          order: before.order,
        },
        {
          status: j.status,
          mode: j.mode,
          scheduled_at: j.scheduled_at,
          order: j.order,
        },
      );
      logEvent(
        s,
        j.job_id,
        action === "cancel"
          ? "CANCELLED"
          : action === "pause"
            ? "PAUSED"
            : action === "schedule"
              ? "JOB_SCHEDULED"
              : "QUEUE_UPDATED",
        `Ação administrativa: ${action}. Sem clique de publicação.`,
      );
      return j;
    });
  }
  pauseJob(id: string) {
    return this.action(id, "pause");
  }
  resumeJob(id: string) {
    return this.action(id, "resume");
  }
  cancelJob(id: string) {
    return this.action(id, "cancel");
  }
  publishNow(id: string) {
    return this.action(id, "publish-now");
  }
  moveToTop(id: string) {
    return this.action(id, "top");
  }
  scheduleJob(id: string, date: string) {
    return this.action(id, "schedule", date);
  }
  async saveAutomation(value: unknown, pauseOnFailure: boolean) {
    if (typeof pauseOnFailure !== "boolean")
      throw new ValidationError("Configuração de segurança inválida.");
    const valid = validateAutomation(value);
    return this.store.transact((s) => {
      for (const k of Object.keys(valid) as (keyof typeof valid)[])
        audit(s, `publishing.${k}`, s.publishing[k], valid[k]);
      audit(
        s,
        "safety.pause_on_system_failure",
        s.safety.pause_on_system_failure,
        pauseOnFailure,
      );
      s.publishing = valid;
      s.safety.pause_on_system_failure = pauseOnFailure;
      return valid;
    });
  }
  async setSystem(status: "ONLINE" | "PAUSED") {
    return this.store.transact((s) => {
      audit(s, "system.status", s.system.status, status);
      s.system = {
        status,
        reason: status === "PAUSED" ? "Pausa administrativa." : null,
      };
      return s.system;
    });
  }
  async saveAccountSettings(id: string, value: unknown) {
    const valid = validateSettings(value);
    return this.store.transact((s) => {
      if (!s.instagram_accounts.some((a) => a.id === id))
        throw new ValidationError("Conta inexistente.");
      const old = s.account_settings[id];
      for (const key of Object.keys(
        valid.story.sticker,
      ) as (keyof typeof valid.story.sticker)[])
        audit(
          s,
          `story.${id}.sticker.${key}`,
          old?.story.sticker[key],
          valid.story.sticker[key],
        );
      for (const key of Object.keys(
        valid.publishing,
      ) as (keyof typeof valid.publishing)[])
        audit(
          s,
          `story.${id}.publishing.${key}`,
          old?.publishing[key],
          valid.publishing[key],
        );
      s.account_settings[id] = valid;
      return valid;
    });
  }
  async recoverAfterCrash() {
    return this.store.transact((s) => {
      let count = 0;
      for (const j of s.queue)
        if (
          ["PREPARING", "READY", "PUBLISHING"].includes(j.status) &&
          !(
            j.status === "READY" &&
            j.awaiting_operator === true &&
            j.attempts === 0 &&
            !j.started_at &&
            s.locks[j.account_id]?.job_id !== j.id
          )
        ) {
          j.status = "REQUIRES_REVIEW";
          j.error_code = "RECOVERED_AFTER_CRASH";
          j.error_message =
            "Execução interrompida; revisão obrigatória antes de qualquer nova publicação.";
          j.finished_at = nowISO();
          const a = j.attempt_history.at(-1);
          if (a && !a.finished_at) {
            a.finished_at = j.finished_at;
            a.outcome = "REQUIRES_REVIEW";
          }
          logEvent(s, j.job_id, "RECOVERED_AFTER_CRASH", j.error_message);
          count++;
        }
      s.locks = {};
      return count;
    });
  }
  async finish(
    id: string,
    status: "SUCCESS" | "FAILED" | "INCONCLUSIVE",
    options: {
      publish_clicked: boolean | null;
      published_at?: string;
      error?: string;
      confirmation?: PublicationConfirmation;
    },
  ) {
    return this.store.transact((s) => {
      const j = s.queue.find((j) => j.id === id);
      if (!j || s.locks[j.account_id]?.job_id !== id)
        throw new ValidationError("Job sem lock ativo.");
      if (status === "SUCCESS") {
        const evidence = options.confirmation;
        if (
          !options.publish_clicked ||
          !evidence ||
          evidence.job_id !== j.job_id ||
          evidence.media_hash !== j.media_hash ||
          !evidence.positive_evidence?.trim() ||
          !options.published_at ||
          !Number.isFinite(Date.parse(options.published_at)) ||
          Date.parse(options.published_at) > Date.now() ||
          Date.parse(options.published_at) < Date.parse(j.started_at!)
        ) {
          status = "INCONCLUSIVE";
          options = {
            ...options,
            error:
              "Sem confirmação positiva associada ao job e fingerprint atuais.",
          };
        }
      }
      const a = j.attempt_history.at(-1)!;
      a.publish_clicked = options.publish_clicked;
      a.finished_at = nowISO();
      a.outcome = status;
      j.finished_at = a.finished_at;
      j.duration_ms = Math.max(
        0,
        Date.parse(j.finished_at) - Date.parse(j.started_at!),
      );
      j.error_message = options.error ?? null;
      j.error_code =
        status === "INCONCLUSIVE"
          ? "PUBLISH_UNCONFIRMED"
          : status === "FAILED"
            ? options.publish_clicked
              ? "POST_CLICK_REQUIRES_REVIEW"
              : j.attempts >= s.publishing.max_attempts
                ? "MAX_ATTEMPTS"
                : "EXECUTION_FAILED"
            : null;
      j.status =
        status === "FAILED" &&
        (options.publish_clicked !== false ||
          j.attempts >= s.publishing.max_attempts)
          ? "REQUIRES_REVIEW"
          : status;
      j.published_at =
        status === "SUCCESS" ? (options.published_at ?? null) : null;
      delete s.locks[j.account_id];
      logEvent(
        s,
        j.job_id,
        j.status,
        "Execução encerrada; nenhuma repetição automática.",
      );
      return j;
    });
  }
}
