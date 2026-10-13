import type { DownloadedMedia } from "../media/downloadStoryMedia.js";
import { ValidationError } from "../admin/domain.js";
export const DEFAULT_FEED_URL = "https://plantaorio.com.br/feed.xml";
export interface FeedConfig {
  enabled: boolean;
  url: string;
  poll_interval_seconds: number;
  auto_enqueue: boolean;
  account_id: string;
}
export type FeedEntryStatus =
  | "DISCOVERED"
  | "RESOLVING"
  | "DOWNLOADING"
  | "READY"
  | "QUEUED"
  | "DUPLICATE"
  | "IGNORED"
  | "ARTICLE_RESOLVE_FAILED"
  | "MEDIA_NOT_FOUND"
  | "MEDIA_DOWNLOAD_FAILED"
  | "MEDIA_INVALID"
  | "REQUIRES_REVIEW";
export interface FeedEntry {
  id: string;
  article_url: string | null;
  aliases: string[];
  feed_guid: string | null;
  account_id: string;
  sticker_text: string;
  detected_at: string;
  created_at: string;
  updated_at: string;
  status: FeedEntryStatus;
  attempts: number;
  last_error: string | null;
  media_url: string | null;
  media_type: "IMAGE" | "VIDEO" | null;
  downloaded_media: DownloadedMedia | null;
  job_id: string | null;
  duplicate_of: string | null;
  retention_days: number | null;
}
export interface FeedState {
  config: FeedConfig;
  last_checked_at: string | null;
  last_completed_at: string | null;
  last_error: string | null;
  entries: FeedEntry[];
}
export function initialFeedState(): FeedState {
  return {
    config: {
      enabled: true,
      url: DEFAULT_FEED_URL,
      poll_interval_seconds: 60,
      auto_enqueue: false,
      account_id: "instagram-default",
    },
    last_checked_at: null,
    last_completed_at: null,
    last_error: null,
    entries: [],
  };
}
export function canonicalArticleURL(value: string, base?: string): string {
  const url = new URL(value, base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new ValidationError("URL HTTP(S) sem credenciais obrigatória.");
  url.hash = "";
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}
/** Campaign tags in the share button do not identify a different article. Other query params remain meaningful. */
export function articleIdentity(value: string, base?: string): string {
  const url = new URL(canonicalArticleURL(value, base));
  for (const key of [...url.searchParams.keys()])
    if (/^utm_/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
export function validateFeedConfig(value: unknown): FeedConfig {
  const v = value as FeedConfig;
  if (
    !v ||
    typeof v.enabled !== "boolean" ||
    typeof v.auto_enqueue !== "boolean" ||
    !Number.isInteger(v.poll_interval_seconds) ||
    v.poll_interval_seconds < 10 ||
    v.poll_interval_seconds > 86400 ||
    typeof v.account_id !== "string" ||
    !v.account_id ||
    typeof v.url !== "string"
  )
    throw new ValidationError(
      "Configuração RSS inválida (intervalo de 10 a 86400 segundos).",
    );
  canonicalArticleURL(v.url);
  return {
    enabled: v.enabled,
    url: v.url,
    poll_interval_seconds: v.poll_interval_seconds,
    auto_enqueue: v.auto_enqueue,
    account_id: v.account_id,
  };
}
export function validateFeedState(s: FeedState) {
  validateFeedConfig(s.config);
  if (!Array.isArray(s.entries))
    throw new ValidationError("Armazenamento RSS inválido.");
  const ids = new Set<string>();
  const statuses = [
    "DISCOVERED",
    "RESOLVING",
    "DOWNLOADING",
    "READY",
    "QUEUED",
    "DUPLICATE",
    "IGNORED",
    "ARTICLE_RESOLVE_FAILED",
    "MEDIA_NOT_FOUND",
    "MEDIA_DOWNLOAD_FAILED",
    "MEDIA_INVALID",
    "REQUIRES_REVIEW",
  ];
  for (const e of s.entries) {
    if (
      !e ||
      typeof e.id !== "string" ||
      !e.id ||
      ids.has(e.id) ||
      !statuses.includes(e.status) ||
      !Array.isArray(e.aliases) ||
      !e.aliases.every((a) => typeof a === "string") ||
      !Number.isInteger(e.attempts) ||
      e.attempts < 0 ||
      !Number.isFinite(Date.parse(e.detected_at)) ||
      typeof e.sticker_text !== "string" ||
      typeof e.account_id !== "string"
    )
      throw new ValidationError("Registro RSS inválido; arquivo preservado.");
    if (e.article_url !== null) canonicalArticleURL(e.article_url);
    if (
      e.downloaded_media &&
      (!e.downloaded_media.local_media_path ||
        e.downloaded_media.file_size <= 0 ||
        !/^[a-f0-9]{64}$/.test(e.downloaded_media.sha256))
    )
      throw new ValidationError("Metadados RSS inválidos.");
    ids.add(e.id);
  }
}
