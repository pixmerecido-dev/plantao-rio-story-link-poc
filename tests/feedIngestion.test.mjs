import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { OperationsStorage } from "../dist/admin/operationsStorage.js";
import { FeedPollingService } from "../dist/ingestion/feedPollingService.js";
import { StoryMediaResolver } from "../dist/ingestion/storyMediaResolver.js";
import { parseFeed } from "../dist/ingestion/rssFeed.js";
import { canonicalArticleURL } from "../dist/ingestion/feedDomain.js";
import { createAdminServer } from "../dist/admin/httpServer.js";
import { JsonStorage } from "../dist/admin/jsonStorage.js";
const bytes = await readFile(resolve("assets/story-test.jpg"));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "feed-ingestion-"));
  let base,
    feedFail = false,
    mediaFail = false,
    mediaHits = 0,
    articleHits = 0;
  const server = createServer((req, res) => {
    if (req.url === "/feed.xml") {
      if (feedFail) {
        res.writeHead(503);
        res.end("temporary error");
        return;
      }
      res.setHeader("Content-Type", "application/rss+xml");
      res.end(
        `<rss version="2.0"><channel><item><guid isPermaLink="false">one</guid><link>${base}/article</link></item></channel></rss>`,
      );
      return;
    }
    if (req.url === "/story/one.jpg") {
      mediaHits++;
      if (mediaFail) {
        res.writeHead(503);
        res.end("failed");
        return;
      }
      res.setHeader("Content-Type", "image/jpeg");
      res.end(bytes);
      return;
    }
    if (req.url === "/article" || req.url === "/alias") {
      articleHits++;
      res.setHeader("Content-Type", "text/html");
      res.end(
        `<html><head><link rel="canonical" href="${base}/article"></head><body><button data-link='${base}/article' data-story="story/one.jpg">Story</button></body></html>`,
      );
      return;
    }
    res.writeHead(404);
    res.end("missing");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const filename = join(root, "operations.json");
  const store = new OperationsStorage(filename);
  const service = new FeedPollingService(store, join(root, "media"));
  await service.configure({
    ...(await store.read()).feed.config,
    url: base + "/feed.xml",
  });
  return {
    root,
    base,
    store,
    service,
    filename,
    counters: () => ({ mediaHits, articleHits }),
    failFeed: (v) => (feedFail = v),
    failMedia: (v) => (mediaFail = v),
    close: async () => {
      await service.stop();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await rm(root, { recursive: true, force: true });
    },
  };
}
const xml = (items) => `<rss><channel>${items}</channel></rss>`;
test("RSS/Atom only preserve article link and guid, normalize URL, reject invalid XML/DTD", () => {
  assert.deepEqual(
    parseFeed(
      xml(
        '<item><title>NOT_NEEDED</title><guid isPermaLink="false">id</guid><link>https://example.com/a/#x</link></item>',
      ),
      "https://example.com/feed",
    ),
    [{ article_url: "https://example.com/a", feed_guid: "id" }],
  );
  assert.equal(
    parseFeed(
      xml("<item><guid>https://example.com/g</guid></item>"),
      "https://example.com/feed",
    )[0].article_url,
    "https://example.com/g",
  );
  assert.equal(
    parseFeed(
      '<feed><entry><id>tag:1</id><link rel="alternate" href="/a"/></entry></feed>',
      "https://example.com/feed",
    )[0].article_url,
    "https://example.com/a",
  );
  assert.equal(
    parseFeed(
      xml('<item><guid isPermaLink="false">opaque</guid></item>'),
      "https://example.com/feed",
    )[0].article_url,
    null,
  );
  assert.throws(() => parseFeed("<rss>broken", "https://example.com"));
  assert.throws(() => parseFeed("<!DOCTYPE rss><rss/>", "https://example.com"));
  assert.throws(() => canonicalArticleURL("https://user:pass@example.com/a"));
});
test("resolver uses real data attributes: standard URL resolution, canonical match, escaped attributes and rejects ambiguity", async () => {
  const response = (html) => async () => ({
    text: html,
    url: "https://plantaorio.com.br/artigo",
  });
  const resolver = new StoryMediaResolver(
    response(
      '<button data-story="story/abc.jpg" data-link="https://plantaorio.com.br/artigo">x</button>',
    ),
  );
  assert.deepEqual(await resolver.resolve("https://plantaorio.com.br/artigo"), {
    article_url: "https://plantaorio.com.br/artigo",
    media_url: "https://plantaorio.com.br/story/abc.jpg",
    media_type: "IMAGE",
  });
  const tagged = new StoryMediaResolver(
    response(
      '<link rel="canonical" href="/artigo"><button data-story="/story/a.jpg" data-link="/artigo?utm_source=story&amp;utm_medium=share"></button>',
    ),
  );
  assert.equal(
    (await tagged.resolve("https://plantaorio.com.br/artigo")).media_url,
    "https://plantaorio.com.br/story/a.jpg",
  );
  const escaped = new StoryMediaResolver(
    response(
      '<button data-story="/story/a.jpg?x=1&amp;y=2" data-link="/artigo"></button>',
    ),
  );
  assert.equal(
    (await escaped.resolve("https://plantaorio.com.br/artigo")).media_url,
    "https://plantaorio.com.br/story/a.jpg?x=1&y=2",
  );
  for (const html of [
    '<button data-story="/a.jpg" data-link="/other"></button>',
    '<button data-story="/a.jpg"></button>',
    '<button data-story="/a.jpg" data-link="/artigo"></button><button data-story="/b.jpg" data-link="/artigo"></button>',
    '<button data-story="javascript:bad()" data-link="/artigo"></button>',
  ])
    await assert.rejects(
      new StoryMediaResolver(response(html)).resolve(
        "https://plantaorio.com.br/artigo",
      ),
      (e) => e.code === "MEDIA_NOT_FOUND",
    );
  await assert.rejects(
    new StoryMediaResolver(
      response('<link rel="canonical" href="https://other.com/x">'),
    ).resolve("https://plantaorio.com.br/artigo"),
    (e) => e.code === "ARTICLE_RESOLVE_FAILED",
  );
});
test("auto_enqueue=false -> local READY; repeated polling, enqueue concurrency and restart never duplicate/download again", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.service.pollOnce()).detected, 1);
    let state = await f.store.read();
    assert.equal(state.feed.entries[0].status, "READY");
    assert.equal(state.queue.length, 0);
    assert.equal(
      state.feed.entries[0].downloaded_media.file_size,
      bytes.length,
    );
    assert.equal((await f.service.pollOnce()).detected, 0);
    assert.equal(f.counters().mediaHits, 1);
    const id = state.feed.entries[0].id;
    await Promise.all([
      f.service.action(id, "enqueue"),
      f.service.action(id, "enqueue"),
    ]);
    state = await f.store.read();
    assert.equal(state.queue.length, 1);
    assert.equal(
      state.queue[0].media_path,
      state.feed.entries[0].downloaded_media.local_media_path,
    );
    assert.equal(state.queue[0].article_url, f.base + "/article");
    assert.equal(state.queue[0].source_media_url, f.base + "/story/one.jpg");
    assert.equal(state.queue[0].local_media_path, state.queue[0].media_path);
    assert.equal(state.queue[0].mime_type, "image/jpeg");
    assert.equal(state.queue[0].sha256, state.queue[0].media_hash);
    assert.equal(state.queue[0].last_error, null);
    assert.equal(state.queue[0].feed_entry_id, id);
    const fresh = new FeedPollingService(
      new OperationsStorage(f.filename),
      join(f.root, "media"),
    );
    await fresh.recover();
    await fresh.pollOnce();
    assert.equal((await fresh.store.read()).queue.length, 1);
    assert.equal(f.counters().mediaHits, 1);
    const events = (await f.store.read()).events.map((e) => e.event);
    for (const event of [
      "FEED_CHECK_STARTED",
      "FEED_CHECK_COMPLETED",
      "NEW_ARTICLE_DETECTED",
      "ARTICLE_RESOLVE_STARTED",
      "STORY_MEDIA_FOUND",
      "MEDIA_DOWNLOAD_STARTED",
      "MEDIA_DOWNLOADED",
      "MEDIA_VALIDATED",
      "QUEUE_JOB_SKIPPED",
      "QUEUE_JOB_CREATED",
      "DUPLICATE_ARTICLE",
    ])
      assert.ok(events.includes(event), event);
  } finally {
    await f.close();
  }
});
test("auto enqueue only after local validation, canonical aliases deduplicated before second download", async () => {
  const f = await fixture();
  try {
    await f.service.configure({
      ...(await f.store.read()).feed.config,
      auto_enqueue: true,
    });
    await f.service.pollOnce();
    assert.equal((await f.store.read()).queue.length, 1);
    const alias = await f.service.ingestArticle(f.base + "/alias", true);
    assert.equal(alias.status, "DUPLICATE");
    assert.equal(f.counters().mediaHits, 1);
    assert.equal((await f.store.read()).queue.length, 1);
  } finally {
    await f.close();
  }
});
test("temporary feed failure recovers; media error has no job and can retry safely; ignore persists", async () => {
  const f = await fixture();
  try {
    f.failFeed(true);
    assert.equal((await f.service.pollOnce()).checked, false);
    assert.match((await f.store.read()).feed.last_error, /503/);
    f.failFeed(false);
    f.failMedia(true);
    await f.service.pollOnce();
    let entry = (await f.store.read()).feed.entries[0];
    assert.equal(entry.status, "MEDIA_DOWNLOAD_FAILED");
    assert.equal((await f.store.read()).queue.length, 0);
    assert.equal((await f.store.read()).feed.last_error, null);
    f.failMedia(false);
    entry = await f.service.action(entry.id, "retry");
    assert.equal(entry.status, "READY");
    await f.service.action(entry.id, "ignore");
    await f.service.pollOnce();
    assert.equal((await f.store.read()).feed.entries[0].status, "IGNORED");
    assert.equal((await f.store.read()).queue.length, 0);
    const hits = f.counters().mediaHits;
    await f.service.action(entry.id, "retry");
    assert.equal(f.counters().mediaHits, hits);
  } finally {
    await f.close();
  }
});
test("disabled polling, config validation, recovery with cached media and hash revalidation", async () => {
  const f = await fixture();
  try {
    await f.service.configure({
      ...(await f.store.read()).feed.config,
      enabled: false,
    });
    assert.equal((await f.service.pollOnce()).reason, "FEED_DISABLED");
    assert.equal(f.counters().mediaHits, 0);
    await assert.rejects(
      f.service.configure({
        ...(await f.store.read()).feed.config,
        poll_interval_seconds: 0,
      }),
    );
    await f.service.pollOnce(true);
    const e = (await f.store.read()).feed.entries[0];
    await f.store.transact((s) => {
      s.feed.entries[0].status = "DOWNLOADING";
    });
    await f.service.recover();
    await f.service.pollOnce(true);
    assert.equal(f.counters().mediaHits, 1);
    await writeFile(e.downloaded_media.local_media_path, "corrupt");
    await assert.rejects(
      f.service.action(e.id, "enqueue"),
      /Mídia baixada mudou|Mídia local inválida/,
    );
    assert.equal((await f.store.read()).queue.length, 0);
    await f.service.action(e.id, "retry");
    assert.equal(f.counters().mediaHits, 2);
    assert.equal((await f.store.read()).feed.entries[0].status, "READY");
  } finally {
    await f.close();
  }
});
test("backend timer operates with no frontend and stops without creating publication attempts", async () => {
  const f = await fixture();
  try {
    f.service.start();
    const deadline = Date.now() + 3000;
    while (
      !(await f.store.read()).feed.last_completed_at &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 20));
    await f.service.stop();
    assert.equal((await f.store.read()).feed.entries[0].status, "READY");
    assert.equal((await f.store.read()).queue.length, 0);
  } finally {
    await f.close();
  }
});
test("RSS HTTP UI flow: config, check, preview, enqueue, old API preserved, no publish route", async () => {
  const f = await fixture();
  const admin = createAdminServer({
    repository: new JsonStorage(join(f.root, "admin.json")),
    root: f.root,
    operationsStore: f.store,
    feedService: f.service,
    clientPath: resolve("dist/admin/client.js"),
  });
  await new Promise((r) => admin.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${admin.address().port}`;
  const req = async (path, method = "GET", body) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Request": "local",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    assert.equal((await req("/api/feed")).data.config.auto_enqueue, false);
    assert.equal((await req("/api/feed/check", "POST", {})).data.checked, true);
    const entry = (await req("/api/feed")).data.entries[0];
    assert.equal(entry.status, "READY");
    assert.equal(entry.downloaded_media.local_media_path, undefined);
    const preview = await fetch(
      base + `/api/feed/entries/${entry.id}/thumbnail`,
    );
    assert.equal(preview.status, 200);
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
    assert.equal(
      (await req(`/api/feed/entries/${entry.id}/enqueue`, "POST", {})).data
        .status,
      "QUEUED",
    );
    assert.equal(
      (await req(`/api/feed/entries/${entry.id}/publish`, "POST", {})).status,
      404,
    );
    assert.equal((await req("/api/operations/queue")).data.jobs.length, 1);
    assert.equal((await req("/api/settings")).status, 200);
    assert.equal(
      (await req("/api/feed/config", "PUT", { enabled: true })).status,
      400,
    );
    assert.equal((await fetch(base + "/assets/feedClient.js")).status, 200);
    assert.equal((await f.store.read()).queue[0].attempts, 0);
  } finally {
    admin.closeAllConnections();
    await new Promise((r) => admin.close(r));
    await f.close();
  }
});
test("URL identity excludes campaign tags, GUID fallback and auto-enqueue existing READY without redownload", async () => {
  const f = await fixture();
  try {
    await f.service.pollOnce();
    await f.service.ingestArticle(f.base + "/article?utm_source=story");
    assert.equal((await f.store.read()).feed.entries.length, 1);
    const config = (await f.store.read()).feed.config;
    await f.service.configure({ ...config, auto_enqueue: true });
    await f.service.pollOnce();
    assert.equal((await f.store.read()).queue.length, 1);
    assert.equal(f.counters().mediaHits, 1);
    const fetcher = async () => ({
      url: f.base + "/feed.xml",
      text: xml(
        '<item><guid isPermaLink="false">opaque-missing-link</guid></item>',
      ),
    });
    const service = new FeedPollingService(f.store, join(f.root, "media"), {
      fetcher,
    });
    await service.pollOnce();
    await service.pollOnce();
    const entries = (await f.store.read()).feed.entries.filter(
      (e) => e.feed_guid === "opaque-missing-link",
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "ARTICLE_RESOLVE_FAILED");
    assert.equal((await f.store.read()).queue.length, 1);
  } finally {
    await f.close();
  }
});
test("migration keeps old local state and video downloads stay generic without running Instagram", async () => {
  const f = await fixture();
  try {
    const old = await f.store.read();
    delete old.feed;
    await writeFile(join(f.root, "legacy.json"), JSON.stringify(old));
    const migrated = await new OperationsStorage(
      join(f.root, "legacy.json"),
    ).read();
    assert.equal(migrated.feed.config.auto_enqueue, false);
    assert.deepEqual(migrated.queue, old.queue);
    const video = await new StoryMediaResolver(async () => ({
      url: "https://example.com/article",
      text: '<button data-story="/story/a.mp4" data-link="/article"></button>',
    })).resolve("https://example.com/article");
    assert.equal(video.media_type, "VIDEO");
    await f.service.pollOnce();
    await f.service.configure({
      ...(await f.store.read()).feed.config,
      auto_enqueue: true,
    });
    await f.store.transact((s) => {
      s.account_settings["instagram-default"].story.sticker.text = "X";
      s.account_settings["instagram-default"].story.sticker.max_text_length = 1;
    });
    assert.equal((await f.service.pollOnce()).checked, true);
    assert.equal(
      (await f.store.read()).feed.entries[0].status,
      "REQUIRES_REVIEW",
    );
    assert.equal((await f.store.read()).queue.length, 0);
  } finally {
    await f.close();
  }
});
