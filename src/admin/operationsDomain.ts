import {
  defaultSettings,
  validateSettings,
  PUBLICATION_STATUSES,
  type StorySettings,
  ValidationError,
} from "./domain.js";
export type QueueStatus =
  | "QUEUED"
  | "SCHEDULED"
  | "PREPARING"
  | "READY"
  | "PUBLISHING"
  | "SUCCESS"
  | "FAILED"
  | "INCONCLUSIVE"
  | "CANCELLED"
  | "PAUSED"
  | "DUPLICATE"
  | "REQUIRES_REVIEW";
export type Priority = "NORMAL" | "HIGH" | "URGENT";
export type JobMode = "IMMEDIATE" | "SCHEDULED" | "AUTO_QUEUE" | "PAUSED";
export interface Account {
  id: string;
  username: string;
  display_name: string;
  expected_username: string;
  detected_username: string | null;
  status: "UNKNOWN" | "OK" | "MISMATCH" | "LOGGED_OUT" | "UNAVAILABLE";
  detected_at: string | null;
  last_seen_at: string | null;
  enabled: boolean;
}
export interface AutomationSettings {
  mode: "IMMEDIATE" | "INTERVAL" | "RATE";
  interval_minutes: number;
  max_per_hour: number;
  max_per_day: number;
  min_interval_minutes: number;
  window_start: string;
  window_end: string;
  allow_urgent_outside_window: boolean;
  enabled: boolean;
  max_attempts: number;
}
export interface FrozenSettings {
  account_id: string;
  sticker_text: string;
  sticker_style_index: 0 | 1 | 2 | 3;
  max_text_length: number | null;
  sticker_scale: number;
  sticker_x_pct: number;
  sticker_y_pct: number;
  facebook_enabled: boolean;
  instagram_enabled: boolean;
  require_link_confirmation: true;
  require_layout_confirmation: true;
  abort_on_layout_failure: true;
}
export interface QueueJob {
  id: string;
  job_id: string;
  account_id: string;
  instagram_username: string | null;
  downloaded_media?: import("../media/downloadStoryMedia.js").DownloadedMedia;
  media_path: string;
  media_type: "IMAGE" | "VIDEO" | "UNSUPPORTED";
  media_filename: string;
  media_hash: string;
  story_url: string;
  sticker_text: string;
  priority: Priority;
  mode: JobMode;
  scheduled_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  published_at: string | null;
  status: QueueStatus;
  attempts: number;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  dedup_key: string;
  order: number;
  effective_settings: FrozenSettings | null;
  facebook_crosspost: boolean | null;
  attempt_history: {
    number: number;
    started_at: string;
    finished_at: string | null;
    outcome: string | null;
    publish_clicked: boolean | null;
  }[];
}
export interface Audit {
  id: string;
  timestamp: string;
  user: "admin-local";
  setting: string;
  old_value: unknown;
  new_value: unknown;
}
export interface OperationalEvent {
  id: string;
  job_id: string;
  timestamp: string;
  event: string;
  message: string;
  metadata?: Record<string, unknown>;
}
export type HealthStatus = "OK" | "DEGRADED" | "OFFLINE" | "UNKNOWN";
export interface Health {
  component: "APP" | "DATABASE" | "APPIUM" | "ADB" | "EMULATOR" | "INSTAGRAM";
  status: HealthStatus;
  message: string;
  checked_at: string;
}
export interface OperationsState {
  version: 1;
  instagram_accounts: Account[];
  account_settings: Record<string, StorySettings>;
  publishing: AutomationSettings;
  safety: { pause_on_system_failure: boolean };
  system: { status: "ONLINE" | "PAUSED" | "ERROR"; reason: string | null };
  queue: QueueJob[];
  events: OperationalEvent[];
  audit: Audit[];
  locks: Record<string, { job_id: string; acquired_at: string }>;
}
export const DEFAULT_ACCOUNT_ID = "instagram-default";
export function initialOperationsState(): OperationsState {
  return {
    version: 1,
    instagram_accounts: [
      {
        id: DEFAULT_ACCOUNT_ID,
        username: "",
        display_name: "Conta Instagram local",
        expected_username: "",
        detected_username: null,
        status: "UNKNOWN",
        detected_at: null,
        last_seen_at: null,
        enabled: true,
      },
    ],
    account_settings: { [DEFAULT_ACCOUNT_ID]: defaultSettings() },
    publishing: {
      mode: "INTERVAL",
      interval_minutes: 120,
      max_per_hour: 3,
      max_per_day: 40,
      min_interval_minutes: 10,
      window_start: "06:00",
      window_end: "23:30",
      allow_urgent_outside_window: false,
      enabled: false,
      max_attempts: 2,
    },
    safety: { pause_on_system_failure: true },
    system: {
      status: "PAUSED",
      reason: "Automação ainda não conectada ao motor.",
    },
    queue: [],
    events: [],
    audit: [],
    locks: {},
  };
}
export function validateAutomation(value: unknown): AutomationSettings {
  const v = value as AutomationSettings;
  if (!v || !["IMMEDIATE", "INTERVAL", "RATE"].includes(v.mode))
    throw new ValidationError("Modo de automação inválido.");
  for (const [key, min, max] of [
    ["interval_minutes", 1, 10080],
    ["max_per_hour", 1, 60],
    ["max_per_day", 1, 1000],
    ["min_interval_minutes", 1, 1440],
    ["max_attempts", 1, 10],
  ] as const)
    if (!Number.isInteger(v[key]) || v[key] < min || v[key] > max)
      throw new ValidationError(`Configuração inválida: ${key}`);
  for (const key of ["window_start", "window_end"] as const)
    if (typeof v[key] !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v[key]))
      throw new ValidationError("Horário inválido.");
  for (const key of ["enabled", "allow_urgent_outside_window"] as const)
    if (typeof v[key] !== "boolean")
      throw new ValidationError("Booleano inválido.");
  return Object.fromEntries(
    [
      "mode",
      "interval_minutes",
      "max_per_hour",
      "max_per_day",
      "min_interval_minutes",
      "window_start",
      "window_end",
      "allow_urgent_outside_window",
      "enabled",
      "max_attempts",
    ].map((k) => [k, v[k as keyof AutomationSettings]]),
  ) as unknown as AutomationSettings;
}

/** Reject damaged local state rather than silently dropping jobs or locks. */
export function validateOperationsState(s: OperationsState): OperationsState {
  const reject = () => {
    throw new ValidationError("Estado operacional persistido inválido.");
  };
  const validDate = (v: unknown, nullable = true) =>
    (nullable && v === null) ||
    (typeof v === "string" && Number.isFinite(Date.parse(v)));
  const text = (v: unknown) => typeof v === "string" && v.length > 0;
  if (
    !s ||
    s.version !== 1 ||
    !Array.isArray(s.queue) ||
    !Array.isArray(s.instagram_accounts) ||
    !Array.isArray(s.events) ||
    !Array.isArray(s.audit) ||
    !s.locks ||
    !s.account_settings ||
    !s.system ||
    typeof s.safety?.pause_on_system_failure !== "boolean"
  )
    reject();
  validateAutomation(s.publishing);
  if (!["ONLINE", "PAUSED", "ERROR"].includes(s.system.status)) reject();
  const ids = new Set<string>();
  for (const a of s.instagram_accounts) {
    if (
      !a ||
      !text(a.id) ||
      ids.has(a.id) ||
      typeof a.expected_username !== "string" ||
      typeof a.username !== "string" ||
      typeof a.display_name !== "string" ||
      typeof a.enabled !== "boolean" ||
      !["UNKNOWN", "OK", "MISMATCH", "LOGGED_OUT", "UNAVAILABLE"].includes(
        a.status,
      ) ||
      !validDate(a.detected_at) ||
      !validDate(a.last_seen_at)
    )
      reject();
    ids.add(a.id);
  }
  for (const [id, settings] of Object.entries(s.account_settings)) {
    if (!ids.has(id)) reject();
    s.account_settings[id] = validateSettings(settings);
  }
  const jobs = new Set<string>(),
    jobIds = new Set<string>();
  for (const j of s.queue) {
    if (
      !j ||
      !text(j.id) ||
      !text(j.job_id) ||
      jobs.has(j.id) ||
      jobIds.has(j.job_id) ||
      !ids.has(j.account_id) ||
      !PUBLICATION_STATUSES.includes(j.status) ||
      !["IMAGE", "VIDEO", "UNSUPPORTED"].includes(j.media_type) ||
      !["NORMAL", "HIGH", "URGENT"].includes(j.priority) ||
      !["IMMEDIATE", "SCHEDULED", "AUTO_QUEUE", "PAUSED"].includes(j.mode) ||
      !text(j.media_path) ||
      !text(j.media_hash) ||
      !text(j.dedup_key) ||
      typeof j.story_url !== "string" ||
      typeof j.sticker_text !== "string" ||
      !Number.isInteger(j.attempts) ||
      j.attempts < 0 ||
      !Number.isFinite(j.order) ||
      !Array.isArray(j.attempt_history) ||
      !validDate(j.created_at, false) ||
      ![j.scheduled_at, j.started_at, j.finished_at, j.published_at].every(
        (v) => validDate(v),
      )
    )
      reject();
    for (const a of j.attempt_history)
      if (
        !Number.isInteger(a.number) ||
        a.number < 1 ||
        !validDate(a.started_at, false) ||
        !validDate(a.finished_at) ||
        (a.publish_clicked !== null && typeof a.publish_clicked !== "boolean")
      )
        reject();
    jobs.add(j.id);
    jobIds.add(j.job_id);
  }
  for (const [id, lock] of Object.entries(s.locks))
    if (
      !ids.has(id) ||
      !lock ||
      !jobs.has(lock.job_id) ||
      !validDate(lock.acquired_at, false)
    )
      reject();
  for (const e of s.events)
    if (
      !e ||
      !text(e.id) ||
      !text(e.job_id) ||
      !text(e.event) ||
      typeof e.message !== "string" ||
      !validDate(e.timestamp, false)
    )
      reject();
  for (const a of s.audit)
    if (
      !a ||
      !text(a.id) ||
      a.user !== "admin-local" ||
      !text(a.setting) ||
      !validDate(a.timestamp, false)
    )
      reject();
  return s;
}

export interface PublicationConfirmation {
  job_id: string;
  media_hash: string;
  positive_evidence: string;
}
