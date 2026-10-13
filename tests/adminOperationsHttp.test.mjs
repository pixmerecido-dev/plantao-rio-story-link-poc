import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { JsonStorage } from "../dist/admin/jsonStorage.js";
import { OperationsStorage } from "../dist/admin/operationsStorage.js";
import { createAdminServer } from "../dist/admin/httpServer.js";
import { defaultSettings } from "../dist/admin/domain.js";
async function fixture() {
  const root = await mkdtemp("/tmp/admin-ops-http-"),
    repository = new JsonStorage(join(root, "admin.json")),
    ops = new OperationsStorage(join(root, "operations.json"));
  const server = createAdminServer({
    repository,
    root,
    operationsStore: ops,
    testMedia: resolve("assets/story-test.jpg"),
    previewPath: resolve("assets/story-test.jpg"),
    clientPath: resolve("dist/admin/client.js"),
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ops,
    request: async (path, method = "GET", data) => {
      const r = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Request": "local",
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { status: r.status, data: await r.json() };
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
test("HTTP operacional mantém fila/timeline/history coerentes, sem vazar caminho nem publicar", async () => {
  const f = await fixture();
  try {
    const created = await f.request("/api/operations/queue", "POST", {
      story_url: "https://example.com/test",
      sticker_text: "Texto exato",
      mode: "SCHEDULED",
      scheduled_at: "2026-10-15T12:00:00Z",
      priority: "HIGH",
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.media_path, undefined);
    assert.equal(created.data.account_id, "instagram-default");
    const id = created.data.id;
    const jobs = (await f.request("/api/publications")).data.items;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].account_id, "instagram-default");
    assert.equal(jobs[0].media_path, undefined);
    assert.equal(
      (
        await f.request(
          "/api/operations/calendar?from=2026-10-15T00:00:00Z&to=2026-10-16T00:00:00Z",
        )
      ).data.length,
      1,
    );
    await f.request(`/api/operations/queue/${id}/pause`, "POST", {});
    assert.equal(
      (await f.request(`/api/operations/queue/${id}`)).data.job.status,
      "PAUSED",
    );
    await f.request(`/api/operations/queue/${id}/resume`, "POST", {});
    assert.equal(
      (await f.request(`/api/operations/queue/${id}/publish-now`, "POST", {}))
        .data.status,
      "QUEUED",
    );
    const result = await f.request("/api/operations/next", "POST", {});
    assert.equal(result.data.reason, "ENGINE_ADAPTER_NOT_CONNECTED");
    assert.equal((await f.ops.read()).queue[0].attempts, 0);
    assert.equal(
      (await f.request("/api/operations/publish", "POST", {})).status,
      404,
    );
  } finally {
    await f.close();
  }
});
test("conta/auditoria/settings por conta não inventam conta confirmada", async () => {
  const f = await fixture();
  try {
    const response = await f.request("/api/operations/account", "PUT", {
      expected_username: "@plantaorio",
      display_name: "Plantão Rio",
      enabled: true,
      password: "NEVER_STORE_ACCOUNT_SECRET",
    });
    assert.equal(response.data.status, "UNKNOWN");
    const detect = await f.request(
      "/api/operations/account/detect",
      "POST",
      {},
    );
    assert.equal(detect.data.status, "UNKNOWN");
    assert.equal(detect.data.detected_username, null);
    const settings = defaultSettings();
    settings.story.sticker.text = "Saiba mais";
    await f.request("/api/settings", "PUT", settings);
    const perAccount = (await f.request("/api/operations/account/settings"))
      .data;
    assert.equal(perAccount.settings.story.sticker.text, "Saiba mais");
    assert.equal(perAccount.account_id, "instagram-default");
    assert.equal(
      JSON.stringify(await f.ops.read()).includes("NEVER_STORE_ACCOUNT_SECRET"),
      false,
    );
    const audit = (await f.request("/api/operations/logs")).data.audit;
    const change = audit.find((a) => a.setting === "account.instagram-default");
    assert.equal(change.old_value.expected_username, "");
    assert.equal(change.new_value.expected_username, "plantaorio");
    assert.ok(audit.some((a) => a.setting.startsWith("story.")));
  } finally {
    await f.close();
  }
});
test("API recusa payload inválido e URL com credenciais", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.request("/api/operations/queue", "POST", {
          story_url: "https://user:pass@example.com",
          sticker_text: "Texto",
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.request("/api/operations/automation", "PUT", {})).status,
      400,
    );
    assert.equal(
      (await f.request("/api/operations/system", "POST", { status: "FAKE" }))
        .status,
      400,
    );
    assert.equal(
      (await f.request("/api/operations/calendar?from=bad&to=bad")).status,
      400,
    );
  } finally {
    await f.close();
  }
});
