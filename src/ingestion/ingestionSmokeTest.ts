import "dotenv/config";
import { resolve } from "node:path";
import { OperationsStorage } from "../admin/operationsStorage.js";
import { FeedPollingService } from "./feedPollingService.js";
import { StoryMediaResolver } from "./storyMediaResolver.js";
import { DEFAULT_FEED_URL } from "./feedDomain.js";
import { fetchText } from "./httpText.js";
import { parseFeed } from "./rssFeed.js";
const kind = process.argv[2];
const article =
  process.env.ARTICLE_URL ??
  "https://plantaorio.com.br/valenca-amplia-atendimento-pelo-sus-com-aditivo-de-35-milhoes-mrdd68z";
const root = resolve(
  process.env.INGESTION_SMOKE_DATA_DIR ?? "data/ingestion-smoke",
);
try {
  if (kind === "feed") {
    const page = await fetchText(
      process.env.FEED_URL ?? DEFAULT_FEED_URL,
      2 * 1024 * 1024,
    );
    const items = parseFeed(page.text, page.url);
    for (const item of items)
      console.log(
        "[FEED] matéria detectada:",
        item.article_url,
        item.feed_guid,
      );
    console.log(
      `[OK] feed válido: ${items.length} itens; nenhuma mídia baixada/job criado.`,
    );
  } else if (kind === "article") {
    const found = await new StoryMediaResolver().resolve(article);
    console.log("[ARTICLE] URL confirmada:", found.article_url);
    console.log("[MEDIA] URL encontrada:", found.media_url);
    console.log(JSON.stringify(found, null, 2));
  } else {
    const store = new OperationsStorage(resolve(root, "operations.json"));
    const service = new FeedPollingService(store, resolve(root, "media"));
    const state = await store.read();
    await service.configure({
      ...state.feed.config,
      enabled: false,
      auto_enqueue: false,
      url: process.env.FEED_URL ?? DEFAULT_FEED_URL,
    });
    await service.recover();
    if (kind === "ingestion") {
      let entry = await service.ingestArticle(article, true);
      if (
        [
          "ARTICLE_RESOLVE_FAILED",
          "MEDIA_NOT_FOUND",
          "MEDIA_DOWNLOAD_FAILED",
          "MEDIA_INVALID",
        ].includes(entry.status)
      ) {
        // Explicit rerun of this isolated smoke may retry intake; never publication.
        entry = await service.action(entry.id, "retry");
        if (entry.status === "READY")
          entry = await service.action(entry.id, "enqueue");
      }
      console.log("[ARTICLE] URL confirmada:", entry.article_url);
      console.log("[MEDIA] URL encontrada:", entry.media_url);
      if (entry.status !== "QUEUED" || !entry.job_id || !entry.downloaded_media)
        throw Error(entry.last_error ?? entry.status);
      console.log("[MEDIA] download concluído");
      console.log("[MEDIA] mime=" + entry.downloaded_media.mime_type);
      console.log("[MEDIA] sha256=" + entry.downloaded_media.sha256);
      console.log(state.queue.some(job => job.job_id === entry.job_id) ? "[QUEUE] job existente reutilizado:" : "[QUEUE] job criado:", entry.job_id);
      console.log("[OK] ingestão concluída");
      console.log("STORY_MEDIA=" + entry.downloaded_media.local_media_path);
      console.log("STORY_URL=" + entry.article_url);
    } else throw Error("Modo esperado: feed, article ou ingestion.");
    console.log(
      "[SAFE] teste isolado; Instagram não acessado; nenhuma publicação.",
    );
    console.log("[DATA]", root);
  }
} catch (error) {
  console.error("[FAIL]", error);
  process.exitCode = 1;
}
