import type { OperationsRepository } from "./operationsStorage.js";
import { logEvent } from "./operationAudit.js";
import { ValidationError, type EventType } from "./domain.js";
export class PublicationLogService {
  constructor(private store: OperationsRepository) {}
  async list(job?: string) {
    return (await this.store.read()).events.filter(
      (e) => !job || e.job_id === job,
    );
  }
  async record(
    jobId: string,
    event: EventType,
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.store.transact((s) => {
      if (!s.queue.some((j) => j.job_id === jobId))
        throw new ValidationError("Job não encontrado.");
      logEvent(s, jobId, event, message, metadata);
    });
  }
  async audit() {
    return (await this.store.read()).audit;
  }
}
