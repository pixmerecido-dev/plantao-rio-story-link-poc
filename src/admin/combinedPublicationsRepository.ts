import type { PublicationsRepository } from "./repositories.js";
import type { PublicationJob, PublicationEvent } from "./domain.js";
import type { QueueJob } from "./operationsDomain.js";
import type { OperationsRepository } from "./operationsStorage.js";
function jobView(j: QueueJob): PublicationJob {
  return {
    id: j.id,
    job_id: j.job_id,
    account_id: j.account_id,
    instagram_username: j.instagram_username,
    priority: j.priority,
    mode: j.mode,
    effective_settings: j.effective_settings
      ? { ...j.effective_settings }
      : null,
    created_at: j.created_at,
    started_at: j.started_at,
    finished_at: j.finished_at,
    published_at: j.published_at,
    media_path: j.media_path,
    media_type: j.media_type,
    media_filename: j.media_filename,
    story_url: j.story_url,
    sticker_text: j.sticker_text,
    sticker_scale: j.effective_settings?.sticker_scale ?? null,
    sticker_x: null,
    sticker_y: null,
    instagram_status: j.status,
    facebook_crosspost: j.facebook_crosspost,
    status: j.status,
    attempts: j.attempts,
    duration_ms: j.duration_ms,
    error_code: j.error_code,
    error_message: j.error_message,
    source_note:
      "Job da fila administrativa; layout configurado não representa execução no Instagram.",
  };
}
/** Read model joins actual imported history and durable queue without duplicating records. */
export class CombinedPublicationsRepository implements PublicationsRepository {
  constructor(
    private history: PublicationsRepository,
    private operations: OperationsRepository,
  ) {}
  async listJobs() {
    return [
      ...(await this.history.listJobs()),
      ...(await this.operations.read()).queue.map(jobView),
    ];
  }
  async findJob(id: string) {
    return (await this.listJobs()).find((j) => j.id === id);
  }
  async listEvents(jobId?: string) {
    const s = await this.operations.read();
    return [
      ...(await this.history.listEvents(jobId)),
      ...s.events.filter((e) => !jobId || e.job_id === jobId),
    ] as PublicationEvent[];
  }
  saveJob(j: PublicationJob) {
    return this.history.saveJob(j);
  }
  appendEvent(e: PublicationEvent) {
    return this.history.appendEvent(e);
  }
  importPublication(j: PublicationJob, e: PublicationEvent) {
    return this.history.importPublication(j, e);
  }
}
