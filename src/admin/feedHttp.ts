import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { FeedPollingService } from "../ingestion/feedPollingService.js";
import { ValidationError } from "./domain.js";
import { resolveStoryMediaReference } from "../media/resolveStoryMedia.js";
export function createFeedApi(service: FeedPollingService) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    body: (req: IncomingMessage) => Promise<any>,
    send: (res: ServerResponse, value: unknown, status?: number) => void,
  ) => {
    const path = url.pathname;
    if (!path.startsWith("/api/feed")) return false;
    const payload = async () => {
      const value = await body(req);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new ValidationError("Objeto JSON obrigatório.");
      return value;
    };
    if (req.method === "GET" && path === "/api/feed") {
      const state = await service.store.read();
      send(res, {
        ...state.feed,
        entries: [...state.feed.entries].reverse().map((entry) => {
          const job = state.queue.find((j) => j.job_id === entry.job_id);
          const media = entry.downloaded_media;
          const { local_media_path, ...safeMedia } = media ?? {};
          return {
            ...entry,
            downloaded_media: media ? safeMedia : null,
            queue_status: job?.status ?? null,
            scheduled_at: job?.scheduled_at ?? null,
            priority: job?.priority ?? "NORMAL",
            source_media_url: media?.source_media_url ?? entry.media_url,
            mime_type: media?.mime_type ?? null,
            sha256: media?.sha256 ?? null,
            download_status:
              media &&
              ![
                "MEDIA_INVALID",
                "MEDIA_DOWNLOAD_FAILED",
                "DOWNLOADING",
              ].includes(entry.status)
                ? "VALIDATED"
                : entry.status,
            thumbnail_available: entry.media_type === "IMAGE" && !!media,
          };
        }),
        engineConnected: false,
        events: state.events
          .filter(
            (e) =>
              e.job_id === "feed" ||
              e.metadata?.entry_id ||
              state.feed.entries.some((entry) => entry.id === e.job_id),
          )
          .slice(-200),
      });
      return true;
    }
    if (req.method === "POST" && path === "/api/feed/ingest") {
      const value = await payload();
      if (typeof value.article_url !== "string")
        throw new ValidationError("article_url obrigatória.");
      const entry = await service.ingestArticle(value.article_url);
      send(res, {
        id: entry.id,
        article_url: entry.article_url,
        job_id: entry.job_id,
        status: entry.status,
        last_error: entry.last_error,
        engineConnected: false,
      });
      return true;
    }
    if (req.method === "PUT" && path === "/api/feed/config") {
      send(res, await service.configure(await payload()));
      return true;
    }
    if (req.method === "POST" && path === "/api/feed/check") {
      await payload();
      send(res, await service.pollOnce(true));
      return true;
    }
    const match =
      /^\/api\/feed\/entries\/([^/]+)\/(enqueue|ignore|retry|thumbnail)$/.exec(
        path,
      );
    if (match) {
      const id = decodeURIComponent(match[1]!);
      const action = match[2]!;
      if (req.method === "POST" && action !== "thumbnail") {
        await payload();
        const result = await service.action(
          id,
          action as "enqueue" | "ignore" | "retry",
        );
        send(res, {
          id: result.id,
          status: result.status,
          job_id: result.job_id,
          last_error: result.last_error,
        });
        return true;
      }
      if (req.method === "GET" && action === "thumbnail") {
        const entry = (await service.store.read()).feed.entries.find(
          (e) => e.id === id,
        );
        const media = entry?.downloaded_media;
        if (!media || entry?.media_type !== "IMAGE") {
          send(res, { error: "Preview indisponível." }, 404);
          return true;
        }
        const local = await resolveStoryMediaReference({
          path: media.local_media_path,
          sha256: media.sha256,
          size: media.file_size,
          mimeType: media.mime_type,
          extension: media.extension,
          type: "IMAGE",
          filename: "",
        });
        if (local.type !== "IMAGE" || local.size > 32 * 1024 * 1024)
          throw new ValidationError("Preview indisponível para esta mídia.");
        res.writeHead(200, {
          "Content-Type": local.mimeType,
          "Cache-Control": "no-store",
        });
        res.end(await readFile(local.path));
        return true;
      }
    }
    send(res, { error: "Recurso RSS não disponível." }, 404);
    return true;
  };
}
