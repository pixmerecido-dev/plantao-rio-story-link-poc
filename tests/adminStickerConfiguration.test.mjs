import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  defaultSettings,
  validateSettings,
  stickerTextLength,
  EVENT_TYPES,
} from "../dist/admin/domain.js";
import { estimateStickerPreview } from "../dist/admin/stickerPreview.js";
import { OperationsStorage } from "../dist/admin/operationsStorage.js";
import {
  PublicationQueueService,
  PublishingScheduler,
  PublishingPolicyService,
} from "../dist/admin/operationalServices.js";
import { DEFAULT_ACCOUNT_ID } from "../dist/admin/operationsDomain.js";
import {
  prepareConfiguredStickerLayout,
  StickerBoundsSession,
  configuredCenterTarget,
} from "../dist/instagram/configuredStickerLayout.js";
const account = DEFAULT_ACCOUNT_ID;
async function storage() {
  return new OperationsStorage(
    join(await mkdtemp("/tmp/admin-styles-"), "ops.json"),
  );
}
const health = [
  "APP",
  "DATABASE",
  "APPIUM",
  "ADB",
  "EMULATOR",
  "INSTAGRAM",
].map((component) => ({
  component,
  status: "OK",
  message: "MOCK",
  checked_at: new Date().toISOString(),
}));
function job(overrides = {}) {
  return {
    job_id: "current-job",
    story_url: "https://example.com/current",
    sticker_text: "Leia a matéria completa",
    sticker_style_index: 0,
    sticker_scale: 529 / 696,
    sticker_x_pct: 347.5 / 1080,
    sticker_y_pct: 1138 / 1920,
    max_text_length: null,
    ...overrides,
  };
}
function port(overrides = {}) {
  let bounds = { left: 200, top: 800, right: 896, bottom: 916 };
  const calls = [],
    events = [];
  const p = {
    calls,
    events,
    get bounds() {
      return structuredClone(bounds);
    },
    set bounds(v) {
      bounds = structuredClone(v);
    },
    async verifyStyle() { return "PASS"; },
    async assertOwnsFreshLink() {
      return true;
    },
    async readSticker(id) {
      calls.push("read");
      return {
        job_id: id,
        displayed: true,
        bounds: structuredClone(bounds),
        canvas: { left: 0, top: 0, right: 1080, bottom: 1920 },
      };
    },
    async tapStyle(id, c) {
      calls.push("tap");
      assert.equal(id, "current-job");
      const center = {
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
      };
      assert.deepEqual(c, center);
      bounds.right += 10;
    },
    async resizeNative(id, scale, current) {
      calls.push("resize");
      assert.deepEqual(current, bounds);
      const x = (bounds.left + bounds.right) / 2,
        y = (bounds.top + bounds.bottom) / 2,
        w = (bounds.right - bounds.left) * scale,
        h = (bounds.bottom - bounds.top) * scale;
      bounds = {
        left: x - w / 2,
        top: y - h / 2,
        right: x + w / 2,
        bottom: y + h / 2,
      };
    },
    async moveW3C(id, target, current) {
      calls.push("move");
      assert.deepEqual(current, bounds);
      const w = bounds.right - bounds.left,
        h = bounds.bottom - bounds.top;
      bounds = {
        left: target.x - w / 2,
        top: target.y - h / 2,
        right: target.x + w / 2,
        bottom: target.y + h / 2,
      };
    },
    async recordEvent(id, event, meta) {
      events.push({ id, event, meta });
    },
    ...overrides,
  };
  return p;
}
test("padrões preservam escala aprovada, índice 0 e limite desconhecido", () => {
  const s = defaultSettings().story.sticker;
  assert.equal(s.style_index, 0);
  assert.equal(s.max_text_length, null);
  assert.equal(s.scale, 529 / 696);
  assert.equal(s.presets[0].name, "PADRÃO");
  assert.equal(s.presets[1].style_index, 2);
});
test("configuração legada recebe campos novos sem perder texto ou posição", () => {
  const s = defaultSettings();
  delete s.story.sticker.style_index;
  delete s.story.sticker.max_text_length;
  delete s.story.sticker.presets;
  s.story.sticker.text = "Texto legado";
  assert.equal(validateSettings(s).story.sticker.style_index, 0);
  assert.equal(validateSettings(s).story.sticker.text, "Texto legado");
});
test("índice é técnico 0..3, sem aceitar nomes, null ou índices fracionários", () => {
  for (const bad of [-1, 4, 1.5, "Azul", null]) {
    const s = defaultSettings();
    s.story.sticker.style_index = bad;
    assert.throws(() => validateSettings(s), /Estilo/);
  }
});
test("limite não inventa 140 caracteres e texto não é truncado", () => {
  const s = defaultSettings();
  s.story.sticker.text = "x".repeat(500);
  assert.equal(validateSettings(s).story.sticker.text.length, 500);
  s.story.sticker.max_text_length = 499;
  assert.throws(() => validateSettings(s), /500.*499.*truncado/);
  assert.equal(s.story.sticker.text.length, 500);
});
test("contador usa code points e limite configurado, sem mudar o texto recebido", () => {
  assert.equal(stickerTextLength("📎A"), 2);
  const s = defaultSettings();
  s.story.sticker.text = "📎A";
  s.story.sticker.max_text_length = 2;
  assert.equal(validateSettings(s).story.sticker.text, "📎A");
  s.story.sticker.max_text_length = 1;
  assert.throws(() => validateSettings(s), /excede/);
});
test("presets guardam nome, texto, índice e escala opcional; nomes únicos", () => {
  const s = defaultSettings();
  s.story.sticker.presets = [
    { name: "TESTE", text: "VEJA+", style_index: 3, scale: 0.8 },
  ];
  assert.deepEqual(
    validateSettings(s).story.sticker.presets,
    s.story.sticker.presets,
  );
  s.story.sticker.presets.push({ ...s.story.sticker.presets[0] });
  assert.throws(() => validateSettings(s), /nomes únicos/);
});
test("largura do preview é dinâmica; escala não é largura absoluta", () => {
  const short = estimateStickerPreview("VEJA+", 0.76),
    middle = estimateStickerPreview("CLIQUE AQUI", 0.76),
    long = estimateStickerPreview("Leia a matéria completa", 529 / 696),
    huge = estimateStickerPreview("a".repeat(500), 0.76);
  assert.ok(
    short.width_px < middle.width_px && middle.width_px < long.width_px,
  );
  assert.ok(Math.abs(long.width_px - 529) < 0.001);
  assert.equal(huge.width_pct, 0.96);
  assert.equal(huge.capped, true);
  assert.equal(huge.text_length, 500);
  assert.equal(
    estimateStickerPreview("VEJA+", 1).width_px * 0.76,
    short.width_px,
  );
});
test("centro percentual não muda com largura do texto, salvo clamp da borda", () => {
  const canvas = { left: 100, top: 50, right: 1100, bottom: 2050 };
  const a = configuredCenterTarget(
      canvas,
      { left: 200, top: 200, right: 400, bottom: 240 },
      0.5,
      0.6,
    ),
    b = configuredCenterTarget(
      canvas,
      { left: 200, top: 200, right: 700, bottom: 280 },
      0.5,
      0.6,
    );
  assert.deepEqual(a.requested, b.requested);
  assert.deepEqual(a.safe, b.safe);
  assert.deepEqual(a.requested, { x: 600, y: 1250 });
});
test("texto/estilo invalidam bounds anteriores e exigem novo read", () => {
  const s = new StickerBoundsSession("job"),
    live = {
      job_id: "job",
      displayed: true,
      bounds: { left: 0, top: 1, right: 50, bottom: 11 },
      canvas: { left: 0, top: 0, right: 100, bottom: 100 },
    };
  s.accept(live);
  for (const change of ["text", "style"]) {
    s.invalidate(change);
    assert.throws(() => s.read(), /invalidados/);
    s.accept(live);
  }
  assert.throws(() => s.accept({ ...live, job_id: "old" }), /job ativo/);
});
test("nenhum toque antes de confirmar sticker novo da transação atual", async () => {
  const p = port({
    async assertOwnsFreshLink() {
      return false;
    },
  });
  await assert.rejects(
    prepareConfiguredStickerLayout(job({ sticker_style_index: 2 }), p),
    /não confirmados/,
  );
  assert.deepEqual(p.calls, []);
});
test("estilo usa N taps frescos; texto/estilo -> bounds -> resize -> bounds -> posição -> bounds", async () => {
  const p = port(),
    d = await prepareConfiguredStickerLayout(
      job({ sticker_style_index: 2 }),
      p,
    );
  assert.equal(p.calls.filter((c) => c === "tap").length, 2);
  assert.equal(d.bounds_before_resize.right - d.bounds_before_resize.left, 716);
  assert.ok(p.calls.indexOf("resize") > p.calls.lastIndexOf("tap"));
  assert.ok(p.calls.indexOf("move") > p.calls.indexOf("resize"));
  assert.equal(d.layout_confirmed, true);
  assert.equal(d.style_index, 2);
  assert.equal(d.text, "Leia a matéria completa");
  assert.equal(d.style_verified_visually, false);
  assert.ok(p.events.some((e) => e.event === "STICKER_BOUNDS_READ"));
  assert.ok(p.events.some((e) => e.event === "LAYOUT_CONFIRMED"));
});
test("índice inicial não toca; layout dentro da tolerância não redimensiona nem move", async () => {
  const p = port();
  p.bounds = { left: 199.5, top: 1080, right: 895.5, bottom: 1196 };
  const current = p.bounds,
    center = {
      x: (current.left + current.right) / 2,
      y: (current.top + current.bottom) / 2,
    };
  const d = await prepareConfiguredStickerLayout(
    job({
      sticker_scale: 1,
      sticker_x_pct: center.x / 1080,
      sticker_y_pct: center.y / 1920,
    }),
    p,
  );
  assert.equal(d.layout_confirmed, true);
  assert.equal(p.calls.includes("tap"), false);
  assert.equal(p.calls.includes("resize"), false);
  assert.equal(p.calls.includes("move"), false);
  assert.equal(
    p.events.some((e) => e.event === "STICKER_RESIZED"),
    false,
  );
});
test("resize sem efeito retorna layout falso; não move nem publica nem troca estratégia", async () => {
  const p = port({
      async resizeNative() {
        p.calls.push("resize");
      },
    }),
    d = await prepareConfiguredStickerLayout(job(), p);
  assert.equal(d.layout_confirmed, false);
  assert.equal(p.calls.filter((c) => c === "resize").length, 3);
  assert.equal(p.calls.includes("move"), false);
  assert.equal(
    p.events.some((e) => e.event === "LAYOUT_CONFIRMED"),
    false,
  );
  assert.equal("publish" in p, false);
});
test("configuração congelada inclui estilo e limite; alterações posteriores não mudam o job", async () => {
  const st = await storage(),
    q = new PublicationQueueService(st);
  const s = (await st.read()).account_settings[account];
  s.story.sticker.style_index = 3;
  s.story.sticker.max_text_length = 30;
  await q.saveAccountSettings(account, s);
  const j = await q.enqueueJob({
    account_id: account,
    media_path: resolve("assets/story-test.jpg"),
    story_url: "https://example.com/styles",
    sticker_text: "Texto do job",
  });
  await st.transact((s) => {
    s.publishing.enabled = true;
    s.system.status = "ONLINE";
    s.instagram_accounts[0].status = "OK";
    s.instagram_accounts[0].expected_username = "plantaorio";
    s.instagram_accounts[0].detected_username = "plantaorio";
    s.publishing.window_start = s.publishing.window_end = "00:00";
  });
  const scheduler = new PublishingScheduler(q, new PublishingPolicyService());
  const claimed = await scheduler.claim(new Date(), health);
  assert.equal(claimed.id, j.id);
  assert.equal(claimed.effective_settings.sticker_style_index, 3);
  assert.equal(claimed.effective_settings.max_text_length, 30);
  s.story.sticker.style_index = 0;
  await q.saveAccountSettings(account, s);
  assert.equal(
    (await st.read()).queue[0].effective_settings.sticker_style_index,
    3,
  );
});
test("fila bloqueia texto acima do limite; alterar limite de QUEUED exige revisão antes de PREPARING", async () => {
  const st = await storage(),
    q = new PublicationQueueService(st),
    s = (await st.read()).account_settings[account];
  s.story.sticker.text = "Curto";
  s.story.sticker.max_text_length = 5;
  await q.saveAccountSettings(account, s);
  await assert.rejects(
    q.enqueueJob({
      account_id: account,
      media_path: resolve("assets/story-test.jpg"),
      story_url: "https://example.com",
      sticker_text: "Muito longo",
    }),
    /limite/,
  );
  s.story.sticker.max_text_length = null;
  await q.saveAccountSettings(account, s);
  await q.enqueueJob({
    account_id: account,
    media_path: resolve("assets/story-test.jpg"),
    story_url: "https://example.com",
    sticker_text: "Muito longo",
  });
  s.story.sticker.max_text_length = 5;
  await q.saveAccountSettings(account, s);
  await st.transact((s) => {
    s.publishing.enabled = true;
    s.system.status = "ONLINE";
    s.instagram_accounts[0].status = "OK";
    s.instagram_accounts[0].expected_username = "plantaorio";
    s.instagram_accounts[0].detected_username = "plantaorio";
    s.publishing.window_start = s.publishing.window_end = "00:00";
  });
  assert.equal(
    await new PublishingScheduler(q, new PublishingPolicyService()).claim(
      new Date(),
      health,
    ),
    null,
  );
  const state = await st.read();
  assert.equal(state.queue[0].status, "REQUIRES_REVIEW");
  assert.equal(state.queue[0].attempts, 0);
});
test("eventos estruturados de estilo e bounds são suportados", () => {
  for (const e of [
    "STICKER_CREATED",
    "STICKER_STYLE_APPLIED",
    "STICKER_BOUNDS_READ",
  ])
    assert.ok(EVENT_TYPES.includes(e));
});
test("configuração inválida do centro aborta antes de qualquer gesto", async () => {
  const p = port();
  await assert.rejects(
    prepareConfiguredStickerLayout(job({ sticker_x_pct: 2 }), p),
    /Configuração/,
  );
  assert.deepEqual(p.calls, []);
});
test("preview do Dashboard escapa conteúdo do texto e não executa HTML", async () => {
  const { dashboardStickerPreview } = await import(
    "../dist/admin/stickerPreview.js"
  );
  const s = defaultSettings();
  s.story.sticker.text = "<script>alert(1)</script>";
  const html = dashboardStickerPreview(s);
  assert.equal(html.includes("<script>"), false);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Prévia aproximada"));
  assert.ok(!html.includes("Centro calculado"));
});

test('style cycle records exactly the requested taps for the current job', async () => {
  for (const index of [0, 1, 2, 3]) {
    const p = port();
    const result = await prepareConfiguredStickerLayout(job({ sticker_style_index: index }), p);
    assert.equal(p.calls.filter(c => c === 'tap').length, index);
    assert.equal(result.style_transaction_confirmed, true);
    const style = p.events.find(e => e.event === 'STICKER_STYLE_APPLIED').meta;
    assert.equal(style.initial_style_index, 0);
    assert.equal(style.requested_style_index, index);
    assert.equal(style.style_transaction_confirmed, true);
  }
});
test('position retries once with fresh bounds, then confirms measurable movement', async () => {
  const p = port();
  const move = p.moveW3C;
  let attempts = 0;
  p.moveW3C = async (...args) => { if (++attempts === 2) await move(...args); };
  const result = await prepareConfiguredStickerLayout(job(), p);
  assert.equal(attempts, 2);
  assert.equal(result.position_ok, true);
  assert.equal(result.layout_confirmed, true);
  const events = p.events.filter(e => e.event === 'STICKER_MOVE_ATTEMPT');
  assert.equal(events.length, 2);
  assert.deepEqual(events[0].meta.delta_actual, { x: 0, y: 0 });
  assert.equal(events[1].meta.position_ok, true);
});
test('unchanged position after two gestures remains partial, never successful', async () => {
  const p = port({ moveW3C: async () => {} });
  const result = await prepareConfiguredStickerLayout(job(), p);
  assert.equal(p.events.filter(e => e.event === 'STICKER_MOVE_ATTEMPT').length, 2);
  assert.equal(result.layout_confirmed, false);
  assert.equal(result.position_ok, false);
});

 test("style commands alone never confirm visual style or complete layout", async () => {
  const p = port();
  delete p.verifyStyle;
  const result = await prepareConfiguredStickerLayout(job({ sticker_style_index: 1 }), p);
  assert.equal(result.style_command_sent, true);
  assert.equal(result.style_transaction_confirmed, true);
  assert.equal(result.style_confirmed, false);
  assert.equal(result.style_result, "UNKNOWN");
  assert.equal(result.layout_confirmed, false);
  assert.equal(result.size_ok, true);
  assert.equal(result.position_ok, true);
 });

 test("rounding tolerance does not accept materially undersized sticker", async () => {
  const p = port();
  p.resizeNative = async () => { p.bounds = { left: 264, top: 914, right: 750, bottom: 994 }; };
  const result = await prepareConfiguredStickerLayout(job({ sticker_scale: 0.853 }), p);
  assert.equal(result.size_ok, false);
  assert.equal(result.move_command_sent, false);
  assert.equal(result.layout_confirmed, false);
 });

 test("resize feedback corrects an overshoot with fresh measured bounds", async () => {
  const p = port(); const native = p.resizeNative; const corrections = [];
  p.resizeNative = async (...args) => {
    corrections.push(args[1]);
    if (corrections.length === 1) p.bounds = { left: 268, top: 914, right: 811, bottom: 1005 };
    else await native(...args);
  };
  const result = await prepareConfiguredStickerLayout(job({ sticker_scale: 0.853 }), p);
  assert.equal(corrections.length, 2);
  assert.ok(corrections[1] > 1);
  assert.equal(result.resize_confirmed, true);
  assert.equal(result.position_confirmed, true);
 });
