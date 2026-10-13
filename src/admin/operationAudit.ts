import { randomUUID } from "node:crypto";
import type { OperationsState } from "./operationsDomain.js";
export const nowISO = () => new Date().toISOString();
export function logEvent(
  s: OperationsState,
  job: string,
  event: string,
  message: string,
  metadata?: Record<string, unknown>,
) {
  s.events.push({
    id: randomUUID(),
    job_id: job,
    timestamp: nowISO(),
    event,
    message,
    ...(metadata ? { metadata } : {}),
  });
}
export function audit(
  s: OperationsState,
  setting: string,
  old_value: unknown,
  new_value: unknown,
) {
  if (JSON.stringify(old_value) !== JSON.stringify(new_value))
    s.audit.push({
      id: randomUUID(),
      timestamp: nowISO(),
      user: "admin-local",
      setting,
      old_value: structuredClone(old_value ?? null),
      new_value: structuredClone(new_value ?? null),
    });
}
