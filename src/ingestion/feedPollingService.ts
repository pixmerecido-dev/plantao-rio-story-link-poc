import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { OperationsRepository } from "../admin/operationsStorage.js";
import { PublicationQueueService } from "../admin/publicationQueueService.js";
import { ValidationError, validateStickerText } from "../admin/domain.js";
import { audit, logEvent, nowISO } from "../admin/operationAudit.js";
import {
  downloadStoryMedia,
  type DownloadedMedia,
} from "../media/downloadStoryMedia.js";
import { resolveStoryMediaReference } from "../media/resolveStoryMedia.js";
import {
  articleIdentity,
  canonicalArticleURL,
  validateFeedConfig,
  type FeedEntry,
  type FeedConfig,
} from "./feedDomain.js";
import {
  StoryMediaResolver,
  ArticleResolveError,
} from "./storyMediaResolver.js";
import { fetchText, type TextFetcher } from "./httpText.js";
import { parseFeed, type FeedItem } from "./rssFeed.js";

type Downloader = (
  url: string,
  options: { directory: string },
) => Promise<DownloadedMedia>;
export class FeedPollingService {
  private queue: PublicationQueueService;
  private resolver: StoryMediaResolver;
  private fetcher: TextFetcher;
  private downloader: Downloader;
  private tail: Promise<unknown> = Promise.resolve();
  private busy = false;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  constructor(
    public readonly store: OperationsRepository,
    private directory = "data/media",
    options: {
      fetcher?: TextFetcher;
      resolver?: StoryMediaResolver;
      downloader?: Downloader;
    } = {},
  ) {
    this.queue = new PublicationQueueService(store);
    this.fetcher = options.fetcher ?? fetchText;
    this.resolver = options.resolver ?? new StoryMediaResolver(this.fetcher);
    this.downloader = options.downloader ?? downloadStoryMedia;
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      this.busy = true;
      try {
        return await fn();
      } finally {
        this.busy = false;
      }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  async configure(value: unknown) {
    const config = validateFeedConfig(value);
    return this.store.transact((s) => {
      if (!s.instagram_accounts.some((a) => a.id === config.account_id))
        throw new ValidationError("Conta RSS inexistente.");
      audit(s, "feed", s.feed.config, config);
      s.feed.config = config;
      return config;
    });
  }
  /** Resume interrupted work after a restart; never copy a valid downloaded file again. */
  async recover() {
    await this.store.transact((s) => {
      for (const entry of s.feed.entries) {
        if (["RESOLVING", "DOWNLOADING"].includes(entry.status)) {
          const job = entry.job_id
            ? s.queue.find((j) => j.job_id === entry.job_id)
            : null;
          entry.status = entry.job_id
            ? job?.status === "READY"
              ? "READY"
              : job?.status === "CANCELLED"
                ? "IGNORED"
                : job
                  ? "QUEUED"
                  : "REQUIRES_REVIEW"
            : "DISCOVERED";
          entry.last_error =
            "Ingestão interrompida; retomada sem nova publicação.";
        }
      }
    });
    await this.materializeReadyEntries();
  }
  async materializeReadyEntries() {
    for (const entry of (await this.store.read()).feed.entries) {
      if (entry.status === "READY" && !entry.job_id) {
        try {
          await this.enqueueEntry(entry.id, true);
        } catch (error) {
          await this.event(
            entry.id,
            "INGESTION_FAILED",
            "Job READY não pôde ser criado.",
            { error: String(error) },
          );
        }
      }
    }
  }
  start() {
    if (this.timer) return;
    this.stopped = false;
    const check = async () => {
      if (this.stopped || this.busy) return;
      try {
        const { feed } = await this.store.read();
        if (this.stopped || this.busy) return;
        if (
          feed.config.enabled &&
          (!feed.last_checked_at ||
            Date.now() - Date.parse(feed.last_checked_at) >=
              feed.config.poll_interval_seconds * 1000)
        )
          await this.pollOnce();
      } catch (error) {
        console.error("[FEED]", error);
      }
    };
    this.timer = setInterval(() => void check(), 1000);
    this.timer.unref();
    void check();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.tail;
  }
  pollOnce(force = false) {
    return this.exclusive(async () => {
      const { feed } = await this.store.read();
      if (!force && !feed.config.enabled)
        return { checked: false, reason: "FEED_DISABLED", detected: 0 };
      await this.store.transact((s) => {
        s.feed.last_checked_at = nowISO();
        s.feed.last_error = null;
        logEvent(s, "feed", "FEED_CHECK_STARTED", "Consultando RSS.", {
          feed_url: feed.config.url,
        });
      });
      let detected = 0;
      try {
        const page = await this.fetcher(feed.config.url, 2 * 1024 * 1024);
        const items = parseFeed(page.text, page.url);
        // Process oldest first so a full feed starts with a chronological queue.
        for (const item of [...items].reverse()) {
          const result = await this.discover(item, feed.config);
          if (result.isNew) detected++;
          if (result.entry && result.entry.status === "DISCOVERED")
            await this.processEntry(result.entry.id);
        }
        // Resume work interrupted after detection/validation, including opt-in auto_enqueue.
        const latest = await this.store.read();
        for (const entry of latest.feed.entries) {
          if (entry.status === "DISCOVERED") await this.processEntry(entry.id);
          else if (
            entry.status === "READY" &&
            latest.feed.config.auto_enqueue
          ) {
            try {
              await this.enqueueEntry(entry.id);
            } catch (error) {
              await this.mutate(entry.id, (e) => {
                if (e.status === "READY") e.status = "REQUIRES_REVIEW";
                e.last_error = String(error);
              });
              await this.event(
                entry.id,
                "INGESTION_FAILED",
                "Enfileiramento requer revisão; demais matérias preservadas.",
                { error: String(error) },
              );
            }
          }
        }
        await this.store.transact((s) => {
          s.feed.last_completed_at = nowISO();
          logEvent(s, "feed", "FEED_CHECK_COMPLETED", "RSS verificado.", {
            items: items.length,
            detected,
          });
        });
        return { checked: true, detected, items: items.length };
      } catch (error) {
        await this.store.transact((s) => {
          s.feed.last_error = String(error);
          s.feed.last_completed_at = nowISO();
          logEvent(
            s,
            "feed",
            "INGESTION_FAILED",
            "Falha na consulta RSS; próxima consulta mantida.",
            { error: String(error) },
          );
        });
        return { checked: false, detected, error: String(error) };
      }
    });
  }
  private discover(item: FeedItem, config: FeedConfig) {
    return this.store.transact((s) => {
      const match = s.feed.entries.find(
        (e) =>
          (item.article_url &&
            ((e.article_url &&
              articleIdentity(e.article_url) ===
                articleIdentity(item.article_url)) ||
              e.aliases.some(
                (a) =>
                  articleIdentity(a) === articleIdentity(item.article_url!),
              ))) ||
          (!item.article_url &&
            item.feed_guid &&
            e.feed_guid === item.feed_guid),
      );
      if (match) {
        logEvent(
          s,
          match.id,
          "DUPLICATE_ARTICLE_SKIPPED",
          "Matéria já detectada; nenhuma nova tarefa.",
          { article_url: item.article_url, feed_guid: item.feed_guid },
        );
        return { entry: match, isNew: false };
      }
      const priorJob = item.article_url
        ? s.queue.find(
            (j) =>
              articleIdentity(j.article_url ?? j.story_url) ===
              articleIdentity(item.article_url!),
          )
        : undefined;
      const text = s.account_settings[config.account_id]?.story.sticker.text;
      if (text === undefined)
        throw new ValidationError(
          "Configuração do sticker da conta RSS ausente.",
        );
      const timestamp = nowISO();
      const entry: FeedEntry = {
        id: randomUUID(),
        article_url: item.article_url,
        aliases: item.article_url ? [item.article_url] : [],
        feed_guid: item.feed_guid,
        account_id: config.account_id,
        sticker_text: text,
        detected_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
        status: priorJob
          ? "DUPLICATE"
          : item.article_url
            ? "DISCOVERED"
            : "ARTICLE_RESOLVE_FAILED",
        attempts: 0,
        last_error: item.article_url
          ? null
          : "RSS não contém URL HTTP(S) válida da matéria.",
        media_url: null,
        media_type: null,
        downloaded_media: null,
        job_id: priorJob?.job_id ?? null,
        duplicate_of: null,
        retention_days: null,
      };
      s.feed.entries.push(entry);
      if (priorJob)
        logEvent(
          s,
          priorJob.job_id,
          "DUPLICATE_ARTICLE_SKIPPED",
          "Matéria já possui job; nova criação/download bloqueados.",
          {
            article_url: entry.article_url,
            entry_id: entry.id,
            job_id: priorJob.job_id,
          },
        );
      logEvent(s, entry.id, "NEW_ARTICLE_DETECTED", "Matéria detectada.", {
        article_url: entry.article_url,
        feed_guid: entry.feed_guid,
      });
      return { entry, isNew: true };
    });
  }
  /** Controlled single-article intake shares the exact RSS resolver/download/queue path. */
  ingestArticle(article_url: string, enqueue = false) {
    return this.exclusive(async () => {
      const state = await this.store.read();
      const found = await this.discover(
        { article_url: canonicalArticleURL(article_url), feed_guid: null },
        state.feed.config,
      );
      if (found.entry.status === "DISCOVERED")
        await this.processEntry(found.entry.id);
      if (enqueue && (await this.entry(found.entry.id)).status === "READY")
        await this.enqueueEntry(found.entry.id);
      return this.entry(found.entry.id);
    });
  }
  private async entry(id: string) {
    const entry = (await this.store.read()).feed.entries.find(
      (e) => e.id === id,
    );
    if (!entry) throw new ValidationError("Matéria não encontrada.");
    return entry;
  }
  private async mutate(id: string, fn: (entry: FeedEntry) => void) {
    return this.store.transact((s) => {
      const entry = s.feed.entries.find((e) => e.id === id);
      if (!entry) throw new ValidationError("Matéria não encontrada.");
      fn(entry);
      entry.updated_at = nowISO();
      return entry;
    });
  }
  private async event(
    id: string,
    event: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.store.transact((s) => {
      const entry = s.feed.entries.find((e) => e.id === id);
      logEvent(s, entry?.job_id ?? id, event, message, {
        entry_id: id,
        article_url: entry?.article_url,
        media_url: entry?.media_url,
        job_id: entry?.job_id,
        ...metadata,
      });
    });
  }
  private async processEntry(id: string) {
    let entry = await this.entry(id);
    if (entry.job_id || ["IGNORED", "DUPLICATE"].includes(entry.status)) return;
    let phase:
      | "ARTICLE_RESOLVE_FAILED"
      | "MEDIA_DOWNLOAD_FAILED"
      | "REQUIRES_REVIEW" = "ARTICLE_RESOLVE_FAILED";
    try {
      entry = await this.mutate(id, (e) => {
        e.attempts++;
        e.status = "RESOLVING";
        e.last_error = null;
      });
      await this.event(
        id,
        "ARTICLE_RESOLVE_STARTED",
        "Resolvendo data-story/data-link.",
      );
      if (!entry.article_url)
        throw new ArticleResolveError(
          "ARTICLE_RESOLVE_FAILED",
          "URL da matéria ausente.",
        );
      const found = entry.media_url
        ? { article_url: entry.article_url, media_url: entry.media_url }
        : await this.resolver.resolve(entry.article_url);
      const duplicate = await this.store.transact((s) => {
        const current = s.feed.entries.find((e) => e.id === id)!;
        const other = s.feed.entries.find(
          (e) =>
            e.id !== id &&
            e.status !== "DUPLICATE" &&
            ((e.article_url &&
              articleIdentity(e.article_url) ===
                articleIdentity(found.article_url)) ||
              e.aliases.some(
                (a) =>
                  articleIdentity(a) === articleIdentity(found.article_url),
              )),
        );
        const priorJob = s.queue.find(
          (j) =>
            j.feed_entry_id !== id &&
            articleIdentity(j.article_url ?? j.story_url) ===
              articleIdentity(found.article_url),
        );
        if (!current.aliases.includes(found.article_url))
          current.aliases.push(found.article_url);
        current.article_url = found.article_url;
        current.media_url = found.media_url;
        if (other || priorJob) {
          current.status = "DUPLICATE";
          current.duplicate_of = other?.id ?? null;
          current.job_id = priorJob?.job_id ?? other?.job_id ?? null;
        }
        return !!other || !!priorJob;
      });
      if (duplicate) {
        await this.event(
          id,
          "DUPLICATE_ARTICLE_SKIPPED",
          "Canonical já processado; download/fila ignorados.",
        );
        return;
      }
      await this.event(id, "STORY_MEDIA_FOUND", "URL do Story encontrada.");
      phase = "MEDIA_DOWNLOAD_FAILED";
      entry = await this.entry(id);
      let media = entry.downloaded_media;
      if (media) {
        try {
          const local = await resolveStoryMediaReference({
            path: media.local_media_path,
            sha256: media.sha256,
            size: media.file_size,
            mimeType: media.mime_type,
            type: entry.media_type ?? "IMAGE",
            extension: media.extension,
            filename: "",
          });
          if (local.type === "UNSUPPORTED") throw Error("Tipo não suportado.");
        } catch {
          media = null;
          await this.mutate(id, (e) => {
            e.downloaded_media = null;
            e.media_type = null;
          });
        }
      }
      if (!media) {
        await this.mutate(id, (e) => {
          e.status = "DOWNLOADING";
        });
        await this.event(
          id,
          "MEDIA_DOWNLOAD_STARTED",
          "Baixando mídia para arquivo local.",
        );
        media = await this.downloader(found.media_url, {
          directory: resolve(this.directory),
        });
        // Persist validated metadata before enqueue: a restart reuses this local file.
        await this.mutate(id, (e) => {
          e.downloaded_media = media;
        });
        await this.event(id, "MEDIA_DOWNLOADED", "Download concluído.", {
          ...media,
        });
      }
      const normalized = await resolveStoryMediaReference({
        path: media.local_media_path,
        sha256: media.sha256,
        size: media.file_size,
        mimeType: media.mime_type,
        type: media.mime_type.startsWith("video/") ? "VIDEO" : "IMAGE",
        extension: media.extension,
        filename: "",
      });
      if (normalized.type === "UNSUPPORTED" || !normalized.size)
        throw Error("Mídia inválida.");
      await this.mutate(id, (e) => {
        e.downloaded_media = media;
        e.media_type = normalized.type as "IMAGE" | "VIDEO";
        e.status = "READY";
      });
      await this.event(
        id,
        "MEDIA_VALIDATED",
        "Mídia local pronta; nenhuma execução no Instagram.",
        { sha256: media.sha256 },
      );
      phase = "REQUIRES_REVIEW";
      await this.enqueueEntry(
        id,
        !(await this.store.read()).feed.config.auto_enqueue,
      );
      if (!(await this.store.read()).feed.config.auto_enqueue)
        await this.event(
          id,
          "QUEUE_JOB_SKIPPED",
          "auto_enqueue=false; aguardando operador.",
        );
    } catch (error) {
      const status =
        error instanceof ArticleResolveError
          ? error.code
          : phase === "MEDIA_DOWNLOAD_FAILED" &&
              /Assinatura|Mídia vazia|Content-Type não suportado|Mídia inválida|MEDIA_CHANGED/i.test(
                String(error),
              )
            ? "MEDIA_INVALID"
            : phase;
      await this.mutate(id, (e) => {
        e.status = status;
        e.last_error = String(error);
      });
      await this.event(
        id,
        status === "MEDIA_NOT_FOUND"
          ? "STORY_MEDIA_NOT_FOUND"
          : "INGESTION_FAILED",
        "Ingestão interrompida; nenhuma tarefa publicável criada.",
        { error: String(error), status },
      );
    }
  }
  private async enqueueEntry(id: string, readyOnly = false) {
    const entry = await this.entry(id);
    if (entry.job_id) {
      const job = (await this.store.read()).queue.find(
        (j) => j.job_id === entry.job_id,
      );
      if (!readyOnly && job?.status === "READY" && job.awaiting_operator)
        await this.queue.action(job.id, "enqueue");
      return this.entry(id);
    }
    if (
      entry.status !== "READY" ||
      !entry.downloaded_media ||
      !entry.article_url
    )
      throw new ValidationError(
        "Somente mídia READY validada pode entrar na fila.",
      );
    try {
      const media = entry.downloaded_media;
      const valid = await resolveStoryMediaReference({
        path: media.local_media_path,
        sha256: media.sha256,
        size: media.file_size,
        mimeType: media.mime_type,
        type: entry.media_type ?? "IMAGE",
        extension: media.extension,
        filename: "",
      });
      if (valid.type === "UNSUPPORTED" || valid.size === 0)
        throw Error("Mídia local inválida.");
    } catch (error) {
      await this.mutate(id, (e) => {
        e.status = "MEDIA_INVALID";
        e.last_error = String(error);
        e.downloaded_media = null;
      });
      await this.event(
        id,
        "INGESTION_FAILED",
        "Mídia local mudou; criação do job bloqueada.",
        { error: String(error) },
      );
      throw new ValidationError(
        "Mídia local inválida ou alterada; tente novamente a ingestão.",
      );
    }
    const state = await this.store.read();
    validateStickerText(
      entry.sticker_text,
      state.account_settings[entry.account_id]?.story.sticker.max_text_length ??
        null,
    );
    await this.queue.enqueueJob({
      account_id: entry.account_id,
      media_path: entry.downloaded_media.local_media_path,
      downloaded_media: entry.downloaded_media,
      feed_entry_id: entry.id,
      ready_only: readyOnly,
      story_url: entry.article_url,
      sticker_text: entry.sticker_text,
      priority: "NORMAL",
      mode: "AUTO_QUEUE",
    });
    return this.entry(id);
  }
  action(id: string, action: "enqueue" | "ignore" | "retry") {
    return this.exclusive(async () => {
      const entry = await this.entry(id);
      if (entry.job_id) {
        if (action === "enqueue") return this.enqueueEntry(id);
        if (action === "ignore") {
          const job = (await this.store.read()).queue.find(
            (j) => j.job_id === entry.job_id,
          );
          if (job?.status === "READY" && job.awaiting_operator) {
            await this.queue.action(job.id, "cancel");
            return this.entry(id);
          }
        }
        throw new ValidationError(
          "Matéria já vinculada à fila; use os controles do job.",
        );
      }
      if (action === "enqueue") return this.enqueueEntry(id);
      if (action === "ignore") {
        if (["RESOLVING", "DOWNLOADING", "DUPLICATE"].includes(entry.status))
          throw new ValidationError(
            "Matéria não pode ser ignorada neste estado.",
          );
        await this.event(
          id,
          "QUEUE_JOB_SKIPPED",
          "Matéria ignorada pelo operador.",
        );
        return this.mutate(id, (e) => {
          e.status = "IGNORED";
        });
      }
      if (
        ![
          "ARTICLE_RESOLVE_FAILED",
          "MEDIA_NOT_FOUND",
          "MEDIA_DOWNLOAD_FAILED",
          "MEDIA_INVALID",
          "DISCOVERED",
          "READY",
          "IGNORED",
          "REQUIRES_REVIEW",
        ].includes(entry.status)
      )
        throw new ValidationError("Matéria não pode ser reprocessada.");
      await this.mutate(id, (e) => {
        e.status = "DISCOVERED";
      });
      await this.processEntry(id);
      return this.entry(id);
    });
  }
}
