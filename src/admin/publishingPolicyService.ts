import { normalizeInstagramHandle } from "./instagramAccountService.js";
import type { QueueJob, OperationsState, Health } from "./operationsDomain.js";
export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  nextEligibleAt: string | null;
}
function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (k: string) => parts.find((p) => p.type === k)!.value;
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}
const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export class PublishingPolicyService {
  canPublish(
    job: QueueJob,
    now: Date,
    s: OperationsState,
    health: Health[],
  ): PolicyDecision {
    const block = (reason: string, next: Date | null = null) => ({
      allowed: false,
      reason,
      nextEligibleAt: next?.toISOString() ?? null,
    });
    const p = s.publishing;
    if (!p.enabled) return block("AUTOMATION_DISABLED");
    if (s.system.status !== "ONLINE") return block("SYSTEM_" + s.system.status);
    if (!["QUEUED", "SCHEDULED"].includes(job.status))
      return block(
        job.status === "SUCCESS" ? "ALREADY_PUBLISHED" : "STATUS_" + job.status,
      );
    if (job.media_type !== "IMAGE") return block("MEDIA_NOT_SUPPORTED");
    if (job.attempts >= p.max_attempts) return block("MAX_ATTEMPTS");
    const a = s.instagram_accounts.find((a) => a.id === job.account_id);
    if (
      !a?.enabled ||
      a.status !== "OK" ||
      !a.expected_username ||
      !a.detected_username ||
      normalizeInstagramHandle(a.expected_username) !==
        normalizeInstagramHandle(a.detected_username)
    )
      return block("ACCOUNT_UNVERIFIED_OR_MISMATCH");
    if (
      !["APP", "DATABASE", "APPIUM", "ADB", "EMULATOR", "INSTAGRAM"].every(
        (c) => health.some((h) => h.component === c && h.status === "OK"),
      )
    )
      return block("HEALTH_NOT_READY");
    if (
      s.locks[job.account_id] ||
      s.queue.some(
        (j) =>
          j.account_id === job.account_id &&
          ["PREPARING", "READY", "PUBLISHING"].includes(j.status),
      )
    )
      return block("ACCOUNT_BUSY");
    if (
      s.queue.some(
        (j) =>
          j.id !== job.id &&
          j.dedup_key === job.dedup_key &&
          [
            "PREPARING",
            "READY",
            "PUBLISHING",
            "SUCCESS",
            "INCONCLUSIVE",
            "REQUIRES_REVIEW",
          ].includes(j.status),
      )
    )
      return block("DUPLICATE");
    if (job.scheduled_at && Date.parse(job.scheduled_at) > now.getTime())
      return block("SCHEDULED_FOR_LATER", new Date(job.scheduled_at));
    const local = localParts(now),
      start = minutes(p.window_start),
      end = minutes(p.window_end),
      inside =
        start === end ||
        (start < end
          ? local.minutes >= start && local.minutes < end
          : local.minutes >= start || local.minutes < end);
    if (
      !inside &&
      !(job.priority === "URGENT" && p.allow_urgent_outside_window)
    ) {
      const next = new Date(now);
      next.setUTCSeconds(0, 0);
      let count = 0;
      while (count++ < 1441) {
        next.setUTCMinutes(next.getUTCMinutes() + 1);
        if (localParts(next).minutes === start) break;
      }
      return block("OUTSIDE_WINDOW", next);
    }
    // Count started attempts conservatively: inconclusive sends may already have published.
    const starts = s.queue
      .filter((j) => j.account_id === job.account_id)
      .flatMap((j) => j.attempt_history.map((a) => Date.parse(a.started_at)))
      .filter((t) => t <= now.getTime());
    const daily = starts.filter(
      (t) => localParts(new Date(t)).day === local.day,
    );
    if (daily.length >= p.max_per_day) {
      const next = new Date(now);
      next.setUTCSeconds(0, 0);
      while (localParts(next).day === local.day)
        next.setUTCMinutes(next.getUTCMinutes() + 1);
      return block("DAILY_LIMIT", next);
    }
    const hourly = starts
      .filter((t) => t > now.getTime() - 3600000)
      .sort((a, b) => a - b);
    if (hourly.length >= p.max_per_hour)
      return block(
        "HOURLY_LIMIT",
        new Date(hourly[hourly.length - p.max_per_hour]! + 3600000),
      );
    const last = starts.length ? Math.max(...starts) : null;
    const gap =
      Math.max(
        p.min_interval_minutes,
        p.mode === "INTERVAL" ? p.interval_minutes : 0,
      ) * 60000;
    if (last !== null && now.getTime() < last + gap)
      return block("MIN_INTERVAL", new Date(last + gap));
    return {
      allowed: true,
      reason: "ELIGIBLE",
      nextEligibleAt: now.toISOString(),
    };
  }
}
