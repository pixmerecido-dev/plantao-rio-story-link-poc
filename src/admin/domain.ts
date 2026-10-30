export const PUBLICATION_STATUSES = [
  "QUEUED",
  "PREPARING",
  "READY",
  "PUBLISHING",
  "SUCCESS",
  "FAILED",
  "INCONCLUSIVE",
  "CANCELLED",
  "SCHEDULED",
  "PAUSED",
  "DUPLICATE",
  "REQUIRES_REVIEW",
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
export const EVENT_TYPES = [
  "JOB_CREATED",
  "MEDIA_RESOLVED",
  "INSTAGRAM_HOME",
  "STORY_EDITOR",
  "MEDIA_LOADED",
  "LINK_ADDED",
  "STICKER_TEXT_APPLIED",
  "STICKER_RESIZED",
  "STICKER_POSITIONED",
  "LAYOUT_CONFIRMED",
  "PUBLISH_CLICKED",
  "FACEBOOK_PROMPT_HANDLED",
  "PUBLISH_CONFIRMED",
  "SUCCESS",
  "FAILED",
  "ARTIFACT_IMPORTED",
  "STICKER_CREATED",
  "STICKER_STYLE_APPLIED",
  "STICKER_BOUNDS_READ",
  "JOB_SCHEDULED",
  "JOB_STARTED",
  "ACCOUNT_CHECKED",
  "PAUSED",
  "CANCELLED",
  "DUPLICATE_DETECTED",
  "QUEUE_UPDATED",
  "REQUIRES_REVIEW",
  "INCONCLUSIVE",
  "RECOVERED_AFTER_CRASH",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const REFERENCE = {
  width: 1080,
  height: 1920,
  stickerWidthBefore: 696,
  stickerWidth: 529,
  stickerHeight: 88,
  centerX: 347.5,
  centerY: 1138,
};
export const ADMIN_TIMEZONE = "America/Sao_Paulo";
export interface StickerPreset {
  name: string;
  text: string;
  style_index: 0 | 1 | 2 | 3;
  scale?: number;
}
export const DEFAULT_STICKER_PRESETS: StickerPreset[] = [
  { name: "PADRÃO", text: "Leia a matéria completa", style_index: 0 },
  { name: "CHAMADA", text: "Clique aqui", style_index: 2 },
  { name: "COMPLETA", text: "Confira a matéria completa", style_index: 0 },
  { name: "DETALHES", text: "Veja os detalhes", style_index: 0 },
  { name: "NOTÍCIA", text: "Acesse a notícia", style_index: 0 },
  { name: "SAIBA MAIS", text: "Saiba mais", style_index: 0 },
];
export const stickerTextLength = (text: string) => Array.from(text).length;
export function validateStickerText(text: unknown, max: number | null): string {
  if (typeof text !== "string" || !text.trim())
    throw new ValidationError("Texto do sticker obrigatório.");
  if (max !== null && stickerTextLength(text) > max)
    throw new ValidationError(
      `Texto com ${stickerTextLength(text)} caracteres excede o limite configurado de ${max}; nenhum conteúdo foi truncado.`,
    );
  return text;
}
export interface StorySettings {
  story: {
    sticker: {
      text: string;
      style_index: 0 | 1 | 2 | 3;
      max_text_length: number | null;
      presets: StickerPreset[];
      scale: number;
      x_pct: number;
      y_pct: number;
      enabled: boolean;
      min_scale: number;
      max_scale: number;
    };
  };
  publishing: { instagram_enabled: boolean; facebook_enabled: boolean };
  safety: {
    require_link_confirmation: boolean;
    require_layout_confirmation: boolean;
    abort_on_layout_failure: boolean;
  };
}
export function defaultSettings(): StorySettings {
  return {
    story: {
      sticker: {
        text: "Leia a matéria completa",
        style_index: 0,
        max_text_length: null,
        presets: structuredClone(DEFAULT_STICKER_PRESETS),
        scale: REFERENCE.stickerWidth / REFERENCE.stickerWidthBefore,
        x_pct: REFERENCE.centerX / REFERENCE.width,
        y_pct: REFERENCE.centerY / REFERENCE.height,
        enabled: true,
        min_scale: 0.5,
        max_scale: 1,
      },
    },
    publishing: { instagram_enabled: true, facebook_enabled: true },
    safety: {
      require_link_confirmation: true,
      require_layout_confirmation: true,
      abort_on_layout_failure: true,
    },
  };
}
export interface PublicationJob {
  article_title?: string;
  id: string;
  job_id: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  published_at: string | null;
  media_path: string | null;
  media_type: "IMAGE" | "VIDEO" | "UNSUPPORTED";
  media_filename: string | null;
  story_url: string;
  sticker_text: string;
  sticker_scale: number | null;
  sticker_x: number | null;
  sticker_y: number | null;
  instagram_status: string;
  facebook_crosspost: boolean | null;
  status: PublicationStatus;
  attempts: number;
  duration_ms: number | null;
  account_id?: string;
  instagram_username?: string | null;
  priority?: string;
  mode?: string;
  effective_settings?: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  source_key?: string;
  source_note?: string;
}
export interface PublicationEvent {
  id: string;
  job_id: string;
  timestamp: string;
  event: EventType;
  message: string;
  metadata?: Record<string, unknown>;
}
export interface AdminState {
  version: 1;
  settings: StorySettings;
  publication_jobs: PublicationJob[];
  publication_events: PublicationEvent[];
}
export class ValidationError extends Error {}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ValidationError("Objeto esperado.");
  return value as Record<string, unknown>;
};
const number = (value: unknown, min: number, max: number, label: string) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new ValidationError(`${label}: valor fora dos limites.`);
  return value;
};
const bool = (value: unknown, label: string) => {
  if (typeof value !== "boolean")
    throw new ValidationError(`${label}: booleano esperado.`);
  return value;
};
export function validateSettings(value: unknown): StorySettings {
  const root = object(value),
    sticker = object(object(root.story).sticker),
    publishing = object(root.publishing),
    safety = object(root.safety);
  const limit =
    sticker.max_text_length === undefined ? null : sticker.max_text_length;
  if (
    limit !== null &&
    (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1)
  )
    throw new ValidationError(
      "Limite de caracteres deve ser inteiro positivo ou vazio.",
    );
  const enabled=bool(sticker.enabled,'Incluir sticker com link');
  if(typeof sticker.text!=='string')throw new ValidationError('Texto do sticker inválido.');
  const text = enabled?validateStickerText(sticker.text, limit as number | null):sticker.text;
  const style = sticker.style_index === undefined ? 0 : sticker.style_index;
  if (
    typeof style !== "number" ||
    !Number.isInteger(style) ||
    style < 0 ||
    style > 3
  )
    throw new ValidationError("Estilo deve ser um índice entre 0 e 3.");
  const rawPresets =
    sticker.presets === undefined ? DEFAULT_STICKER_PRESETS : sticker.presets;
  if (!Array.isArray(rawPresets))
    throw new ValidationError("Presets inválidos.");
  const names = new Set<string>();
  const presets = rawPresets.map((raw) => {
    const p = object(raw);
    if (typeof p.name !== "string" || !p.name.trim() || names.has(p.name))
      throw new ValidationError("Presets exigem nomes únicos.");
    names.add(p.name);
    const index = p.style_index;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > 3
    )
      throw new ValidationError("Estilo do preset inválido.");
    const preset: StickerPreset = {
      name: p.name,
      text: validateStickerText(p.text, null),
      style_index: index as 0 | 1 | 2 | 3,
    };
    if (p.scale !== undefined)
      preset.scale = number(p.scale, 0.25, 1.25, "Escala do preset");
    return preset;
  });
  const min = number(sticker.min_scale, 0.25, 1.25, "Tamanho mínimo"),
    max = number(sticker.max_scale, 0.25, 1.25, "Tamanho máximo");
  if (min > max)
    throw new ValidationError("Mínimo não pode ultrapassar o máximo.");
  for (const key of [
    "require_link_confirmation",
    "require_layout_confirmation",
    "abort_on_layout_failure",
  ])
    if (safety[key] !== true)
      throw new ValidationError(
        "As confirmações de segurança devem permanecer ativas.",
      );
  return {
    story: {
      sticker: {
        text,
        style_index: style as 0 | 1 | 2 | 3,
        max_text_length: limit as number | null,
        presets,
        scale: number(sticker.scale, min, max, "Escala"),
        x_pct: number(sticker.x_pct, 0, 1, "Posição horizontal"),
        y_pct: number(sticker.y_pct, 0, 1, "Posição vertical"),
        enabled,
        min_scale: min,
        max_scale: max,
      },
    },
    publishing: {
      instagram_enabled: bool(publishing.instagram_enabled, "Instagram"),
      facebook_enabled: bool(publishing.facebook_enabled, "Facebook"),
    },
    safety: {
      require_link_confirmation: true,
      require_layout_confirmation: true,
      abort_on_layout_failure: true,
    },
  };
}
export function validateJob(value: PublicationJob): PublicationJob {
  if (
    !value.id ||
    !value.job_id ||
    value.id.length > 128 ||
    value.job_id.length > 128 ||
    !PUBLICATION_STATUSES.includes(value.status)
  )
    throw new ValidationError("Identidade/status do job inválidos.");
  if (!["IMAGE", "VIDEO", "UNSUPPORTED"].includes(value.media_type))
    throw new ValidationError("Tipo de mídia inválido.");
  for (const date of [
    value.created_at,
    value.started_at,
    value.finished_at,
    value.published_at,
  ])
    if (
      date !== null &&
      (typeof date !== "string" || !Number.isFinite(Date.parse(date)))
    )
      throw new ValidationError("Data do job inválida.");
  let url: URL;
  try {
    url = new URL(value.story_url);
  } catch {
    throw new ValidationError("URL da matéria inválida.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new ValidationError("URL HTTP(S) obrigatória.");
  if (typeof value.sticker_text !== "string")
    throw new ValidationError("Texto inválido.");
  if (!Number.isInteger(value.attempts) || value.attempts < 0)
    throw new ValidationError("Tentativas inválidas.");
  if (value.duration_ms !== null)
    number(value.duration_ms, 0, Number.MAX_SAFE_INTEGER, "Duração");
  for (const v of [value.sticker_scale, value.sticker_x, value.sticker_y])
    if (v !== null) number(v, 0, Number.MAX_SAFE_INTEGER, "Layout");
  if (value.facebook_crosspost !== null)
    bool(value.facebook_crosspost, "Crosspost");
  for (const text of [
    value.media_path,
    value.media_filename,
    value.error_code,
    value.error_message,
    value.instagram_status,
  ])
    if (text !== null && typeof text !== "string")
      throw new ValidationError("Campo textual do job inválido.");
  const keys = [
    "id",
    "job_id",
    "created_at",
    "started_at",
    "finished_at",
    "published_at",
    "media_path",
    "media_type",
    "media_filename",
    "story_url",
    "sticker_text",
    "sticker_scale",
    "sticker_x",
    "sticker_y",
    "instagram_status",
    "facebook_crosspost",
    "status",
    "attempts",
    "duration_ms",
    "error_code",
    "error_message",
    "source_key",
    "source_note",
    "account_id",
    "instagram_username",
    "priority",
    "mode",
    "effective_settings",
  ] as const;
  value = {
    ...value,
    account_id: value.account_id ?? "legacy-unverified",
    instagram_username: value.instagram_username ?? null,
  };
  return structuredClone(
    Object.fromEntries(
      keys
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, value[key]]),
    ),
  ) as unknown as PublicationJob;
}
export function validateEvent(value: PublicationEvent): PublicationEvent {
  if (
    !value.id ||
    !value.job_id ||
    !EVENT_TYPES.includes(value.event) ||
    !Number.isFinite(Date.parse(value.timestamp)) ||
    typeof value.message !== "string"
  )
    throw new ValidationError("Evento inválido.");
  if (value.metadata !== undefined) object(value.metadata);
  return structuredClone(value);
}
