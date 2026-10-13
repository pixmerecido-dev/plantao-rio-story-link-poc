import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { OperationsStorage } from "../dist/admin/operationsStorage.js";
import {
  initialOperationsState,
  DEFAULT_ACCOUNT_ID,
  validateAutomation,
} from "../dist/admin/operationsDomain.js";
import {
  PublicationQueueService,
  PublishingPolicyService,
  PublishingScheduler,
  InstagramAccountService,
  DeduplicationService,
  orderedJobs,
} from "../dist/admin/operationalServices.js";
const account = DEFAULT_ACCOUNT_ID,
  now = new Date("2026-10-13T15:00:00Z");
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
  message: "TEST ONLY",
  checked_at: now.toISOString(),
}));
const media = resolve("assets/story-test.jpg");
function job(id = "one", override = {}) {
  return {
    id,
    job_id: id,
    account_id: account,
    instagram_username: null,
    media_path: media,
    media_type: "IMAGE",
    media_filename: "story-test.jpg",
    media_hash: "hash",
    story_url: "https://example.com/" + id,
    sticker_text: "Texto EXATO",
    priority: "NORMAL",
    mode: "AUTO_QUEUE",
    scheduled_at: null,
    created_at: now.toISOString(),
    started_at: null,
    finished_at: null,
    published_at: null,
    status: "QUEUED",
    attempts: 0,
    duration_ms: null,
    error_code: null,
    error_message: null,
    dedup_key: id,
    order: 1,
    effective_settings: null,
    facebook_crosspost: null,
    attempt_history: [],
    ...override,
  };
}
function state() {
  const s = initialOperationsState();
  s.system = { status: "ONLINE", reason: null };
  s.publishing.enabled = true;
  s.publishing.mode = "RATE";
  s.instagram_accounts[0].expected_username = "plantaorio";
  s.instagram_accounts[0].detected_username = "plantaorio";
  s.instagram_accounts[0].status = "OK";
  return s;
}
const policy = new PublishingPolicyService();
function decide(s, j = job(), h = health, time = now) {
  return policy.canPublish(j, time, s, h);
}
async function store() {
  return new OperationsStorage(
    join(await mkdtemp("/tmp/admin-ops-"), "operations.json"),
  );
}
function history(s, timestamps) {
  s.queue = timestamps.map((t, i) =>
    job("past" + i, {
      status: "SUCCESS",
      started_at: t,
      published_at: t,
      attempts: 1,
      attempt_history: [
        {
          number: 1,
          started_at: t,
          finished_at: t,
          outcome: "SUCCESS",
          publish_clicked: true,
        },
      ],
    }),
  );
}
test("política permite job elegível com conta e health confirmados", () =>
  assert.equal(decide(state()).allowed, true));
for (const [title, mutate, reason] of [
  [
    "automação desligada",
    (s) => (s.publishing.enabled = false),
    "AUTOMATION_DISABLED",
  ],
  ["postador pausado", (s) => (s.system.status = "PAUSED"), "SYSTEM_PAUSED"],
  [
    "conta mismatch",
    (s) => (s.instagram_accounts[0].detected_username = "other"),
    "ACCOUNT_UNVERIFIED_OR_MISMATCH",
  ],
  [
    "conta UNKNOWN",
    (s) => (s.instagram_accounts[0].status = "UNKNOWN"),
    "ACCOUNT_UNVERIFIED_OR_MISMATCH",
  ],
  [
    "conta desabilitada",
    (s) => (s.instagram_accounts[0].enabled = false),
    "ACCOUNT_UNVERIFIED_OR_MISMATCH",
  ],
  [
    "lock da conta",
    (s) =>
      (s.locks[account] = { job_id: "active", acquired_at: now.toISOString() }),
    "ACCOUNT_BUSY",
  ],
  [
    "job ativo sem lock",
    (s) => s.queue.push(job("active", { status: "PUBLISHING" })),
    "ACCOUNT_BUSY",
  ],
  [
    "job duplicado confirmado",
    (s) => s.queue.push(job("other", { status: "SUCCESS", dedup_key: "one" })),
    "DUPLICATE",
  ],
])
  test(title, () => {
    const s = state();
    mutate(s);
    assert.equal(decide(s).reason, reason);
  });
test("health offline e UNKNOWN bloqueiam; componentes faltantes também", () => {
  for (const status of ["OFFLINE", "UNKNOWN"]) {
    const h = structuredClone(health);
    h[2].status = status;
    assert.equal(decide(state(), job(), h).reason, "HEALTH_NOT_READY");
  }
  assert.equal(decide(state(), job(), []).allowed, false);
});
test("limite por hora calcula próximo horário e inclui inconclusivos", () => {
  const s = state();
  history(s, [
    "2026-10-13T14:15:00Z",
    "2026-10-13T14:30:00Z",
    "2026-10-13T14:45:00Z",
  ]);
  s.queue[0].status = "INCONCLUSIVE";
  const d = decide(s);
  assert.equal(d.reason, "HOURLY_LIMIT");
  assert.equal(d.nextEligibleAt, "2026-10-13T15:15:00.000Z");
});
test("limite diário segue dia em Brasília, não UTC", () => {
  const s = state();
  s.publishing.max_per_day = 1;
  history(s, ["2026-10-13T02:00:00Z"]);
  assert.equal(decide(s).allowed, true);
  history(s, ["2026-10-13T04:00:00Z"]);
  assert.equal(decide(s).reason, "DAILY_LIMIT");
  assert.equal(decide(s).nextEligibleAt, "2026-10-14T03:00:00.000Z");
});
test("intervalo mínimo e modo INTERVAL", () => {
  const s = state();
  history(s, ["2026-10-13T14:55:00Z"]);
  assert.equal(decide(s).reason, "MIN_INTERVAL");
  assert.equal(decide(s).nextEligibleAt, "2026-10-13T15:05:00.000Z");
  s.publishing.mode = "INTERVAL";
  assert.equal(decide(s).nextEligibleAt, "2026-10-13T16:55:00.000Z");
});
test("janela e urgente fora da janela não ignoram outros limites", () => {
  const s = state(),
    late = new Date("2026-10-14T03:30:00Z");
  assert.equal(decide(s, job(), health, late).reason, "OUTSIDE_WINDOW");
  s.publishing.allow_urgent_outside_window = true;
  assert.equal(
    decide(s, job("urgent", { priority: "URGENT" }), health, late).allowed,
    true,
  );
  s.publishing.enabled = false;
  assert.equal(
    decide(s, job("urgent", { priority: "URGENT" }), health, late).allowed,
    false,
  );
});
test("janela atravessando meia-noite e janela dia inteiro", () => {
  const s = state();
  s.publishing.window_start = "22:00";
  s.publishing.window_end = "06:00";
  assert.equal(decide(s).reason, "OUTSIDE_WINDOW");
  assert.equal(
    decide(s, job(), health, new Date("2026-10-14T02:00:00Z")).allowed,
    true,
  );
  s.publishing.window_end = s.publishing.window_start;
  assert.equal(decide(s).allowed, true);
});
test("agendado para futuro, já publicado, vídeo e max_attempts são bloqueados", () => {
  for (const [j, reason] of [
    [
      job("future", { scheduled_at: "2026-10-14T15:00:00Z" }),
      "SCHEDULED_FOR_LATER",
    ],
    [job("sent", { status: "SUCCESS" }), "ALREADY_PUBLISHED"],
    [job("video", { media_type: "VIDEO" }), "MEDIA_NOT_SUPPORTED"],
    [job("limit", { attempts: 2 }), "MAX_ATTEMPTS"],
  ])
    assert.equal(decide(state(), j).reason, reason);
});
test("fila ordena URGENT, HIGH, NORMAL sem interromper PUBLISHING", () => {
  const s = state();
  s.queue = [
    job("normal", { order: -100 }),
    job("high", { priority: "HIGH", order: 5 }),
    job("urgent", { priority: "URGENT", order: 10 }),
    job("active", { status: "PUBLISHING", priority: "URGENT" }),
  ];
  assert.deepEqual(
    orderedJobs(s).map((j) => j.id),
    ["urgent", "high", "normal"],
  );
  assert.equal(decide(s).reason, "ACCOUNT_BUSY");
});
test("dedup key usa conta, URL e hash; nome de arquivo não é identidade", () => {
  assert.equal(
    DeduplicationService.key("a", "u", "h"),
    DeduplicationService.key("a", "u", "h"),
  );
  assert.notEqual(
    DeduplicationService.key("a", "u", "h"),
    DeduplicationService.key("b", "u", "h"),
  );
  assert.notEqual(
    DeduplicationService.key("a", "u", "h"),
    DeduplicationService.key("a", "u", "h2"),
  );
});
test("enqueue concorrente persiste somente um job publicável para mesma mídia/URL", async () => {
  const st = await store(),
    q = new PublicationQueueService(st),
    input = {
      account_id: account,
      media_path: media,
      story_url: "https://example.com/news",
      sticker_text: "Texto recebido",
    };
  const jobs = await Promise.all([
    q.enqueueJob(input),
    q.enqueueJob(input),
    q.enqueueJob(input),
  ]);
  assert.equal(jobs.filter((j) => j.status === "QUEUED").length, 1);
  assert.equal(jobs.filter((j) => j.status === "DUPLICATE").length, 2);
  assert.equal(
    (await st.read()).events.filter((e) => e.event === "DUPLICATE_DETECTED")
      .length,
    2,
  );
});
test("configuração congelada por job e lock exclusivo em claim concorrente", async () => {
  const st = await store(),
    q = new PublicationQueueService(st),
    scheduler = new PublishingScheduler(q, policy);
  await st.transact((s) =>
    Object.assign(s, state(), { queue: [job("a"), job("b", { order: 2 })] }),
  );
  const claims = await Promise.all([
    scheduler.claim(now, health),
    scheduler.claim(now, health),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const frozen = claims.find(Boolean).effective_settings;
  const settings = (await st.read()).account_settings[account];
  settings.story.sticker.scale = 0.9;
  await q.saveAccountSettings(account, settings);
  assert.equal(
    (await st.read()).queue[0].effective_settings.sticker_scale,
    frozen.sticker_scale,
  );
  assert.equal(
    (await st.read()).queue[0].effective_settings.sticker_text,
    "Texto EXATO",
  );
});
test("recuperação após crash move PREPARING READY PUBLISHING para revisão, sem repetição", async () => {
  const file = join(await mkdtemp("/tmp/admin-recovery-"), "ops.json"),
    st = new OperationsStorage(file);
  await st.transact((s) => {
    s.queue = ["PREPARING", "READY", "PUBLISHING", "QUEUED"].map((status, i) =>
      job("j" + i, { status }),
    );
    s.locks[account] = { job_id: "j2", acquired_at: now.toISOString() };
  });
  const restarted = new OperationsStorage(file),
    q = new PublicationQueueService(restarted);
  assert.equal(await q.recoverAfterCrash(), 3);
  const s = await restarted.read();
  assert.deepEqual(
    s.queue.map((j) => j.status),
    ["REQUIRES_REVIEW", "REQUIRES_REVIEW", "REQUIRES_REVIEW", "QUEUED"],
  );
  assert.deepEqual(s.locks, {});
  assert.equal(
    s.events.filter((e) => e.event === "RECOVERED_AFTER_CRASH").length,
    3,
  );
  assert.equal(await q.recoverAfterCrash(), 0);
});
test("conta não inventa detecção; adapter mismatch bloqueia", async () => {
  const st = await store(),
    svc = new InstagramAccountService(st);
  await svc.configure(account, {
    expected_username: "@plantaorio",
    display_name: "Plantão",
    enabled: true,
  });
  assert.equal((await svc.detectCurrentAccount(account)).status, "UNKNOWN");
  assert.equal((await svc.validateActiveAccount(account)).match, false);
  const detector = new InstagramAccountService(st, async () => ({
    username: "other",
    status: "OK",
  }));
  assert.equal(
    (await detector.detectCurrentAccount(account)).status,
    "MISMATCH",
  );
});
test("pausa automática preserva jobs QUEUED quando health offline", async () => {
  const st = await store(),
    q = new PublicationQueueService(st);
  await st.transact((s) => Object.assign(s, state(), { queue: [job()] }));
  const scheduler = new PublishingScheduler(q, policy),
    h = structuredClone(health);
  h[2].status = "OFFLINE";
  assert.equal((await scheduler.tick(now, h)).started, false);
  const s = await st.read();
  assert.equal(s.system.status, "PAUSED");
  assert.equal(s.queue[0].status, "QUEUED");
  assert.equal(s.queue[0].attempts, 0);
});
test("sem adapter scheduler não executa nem congela jobs", async () => {
  const st = await store(),
    q = new PublicationQueueService(st);
  await st.transact((s) => Object.assign(s, state(), { queue: [job()] }));
  const scheduler = new PublishingScheduler(q, policy);
  assert.equal(
    (await scheduler.tick(now, health)).reason,
    "ENGINE_ADAPTER_NOT_CONNECTED",
  );
  assert.equal((await st.read()).queue[0].status, "QUEUED");
});
test("max_attempts e risco pós-clique exigem revisão; INCONCLUSIVE não volta à fila", async () => {
  for (const [attempts, clicked, outcome, expected] of [
    [2, false, "FAILED", "REQUIRES_REVIEW"],
    [1, true, "FAILED", "REQUIRES_REVIEW"],
    [1, true, "INCONCLUSIVE", "INCONCLUSIVE"],
  ]) {
    const st = await store(),
      q = new PublicationQueueService(st);
    await st.transact((s) => {
      s.queue = [
        job("a", {
          status: "PUBLISHING",
          attempts,
          started_at: now.toISOString(),
          attempt_history: [
            {
              number: attempts,
              started_at: now.toISOString(),
              finished_at: null,
              outcome: null,
              publish_clicked: clicked,
            },
          ],
        }),
      ];
      s.locks[account] = { job_id: "a", acquired_at: now.toISOString() };
    });
    assert.equal(
      (await q.finish("a", outcome, { publish_clicked: clicked })).status,
      expected,
    );
    await assert.rejects(q.resumeJob("a"));
  }
});
test("persistência de fila, calendário, conta, settings, eventos e auditoria após restart", async () => {
  const file = join(await mkdtemp("/tmp/admin-restart-"), "ops.json"),
    st = new OperationsStorage(file),
    q = new PublicationQueueService(st);
  await q.enqueueJob({
    account_id: account,
    media_path: media,
    story_url: "https://example.com",
    sticker_text: "Exato",
    mode: "SCHEDULED",
    scheduled_at: "2026-10-14T15:00:00Z",
  });
  await q.setSystem("ONLINE");
  await new InstagramAccountService(st).configure(account, {
    expected_username: "plantaorio",
    display_name: "Plantão",
    enabled: true,
  });
  assert.deepEqual(await new OperationsStorage(file).read(), await st.read());
});
test("ações administrativas não modificam job ativo ou finalizado", async () => {
  const st = await store(),
    q = new PublicationQueueService(st);
  await st.transact((s) => {
    s.queue = [
      job("p", { status: "PUBLISHING" }),
      job("s", { status: "SUCCESS" }),
    ];
  });
  for (const id of ["p", "s"])
    for (const a of [
      "pause",
      "resume",
      "cancel",
      "top",
      "publish-now",
      "schedule",
    ])
      await assert.rejects(q.action(id, a, "2026-10-14T15:00:00Z"));
});
test("configurações inválidas rejeitadas; armazenamento corrompido preservado", async () => {
  for (const change of [
    (p) => (p.max_per_hour = 0),
    (p) => (p.max_attempts = 0),
    (p) => (p.window_start = "25:00"),
    (p) => (p.enabled = "true"),
  ]) {
    const p = initialOperationsState().publishing;
    change(p);
    assert.throws(() => validateAutomation(p));
  }
  const file = join(await mkdtemp("/tmp/admin-corrupt-"), "ops.json");
  await writeFile(file, "broken");
  await assert.rejects(new OperationsStorage(file).read(), /preservado/);
  assert.equal(await readFile(file, "utf8"), "broken");
});
test("scheduler executa no máximo um adapter simultâneo e registra a tentativa", async () => {
  const st = await store(),
    q = new PublicationQueueService(st);
  await st.transact((s) =>
    Object.assign(s, state(), { queue: [job("a"), job("b", { order: 2 })] }),
  );
  let release;
  const wait = new Promise((r) => (release = r));
  let calls = 0;
  const adapter = {
    async execute() {
      calls++;
      await wait;
      return { status: "INCONCLUSIVE", publish_clicked: true };
    },
  };
  const scheduler = new PublishingScheduler(q, policy, adapter);
  const first = scheduler.tick(now, health);
  while (!calls) await new Promise((r) => setTimeout(r, 5));
  assert.equal((await scheduler.tick(now, health)).reason, "SCHEDULER_BUSY");
  release();
  await first;
  assert.equal(calls, 1);
  const s = await st.read();
  assert.equal(s.queue[0].status, "INCONCLUSIVE");
  assert.equal(s.queue[1].status, "QUEUED");
  assert.equal(s.queue[0].attempt_history[0].publish_clicked, true);
  assert.deepEqual(s.locks, {});
});
test("adapter lança erro pós-envio: INCONCLUSIVE sem retry", async () => {
  const st = await store(),
    q = new PublicationQueueService(st);
  await st.transact((s) => Object.assign(s, state(), { queue: [job()] }));
  let calls = 0;
  const scheduler = new PublishingScheduler(q, policy, {
    async execute() {
      calls++;
      throw Error("timeout");
    },
  });
  await scheduler.tick(now, health);
  await scheduler.tick(new Date(now.getTime() + 3600000), health);
  assert.equal(calls, 1);
  assert.equal((await st.read()).queue[0].status, "INCONCLUSIVE");
  assert.equal(
    (await st.read()).queue[0].attempt_history[0].publish_clicked,
    null,
  );
});
test("SUCCESS do adapter exige confirmação positiva do job/fingerprint atual", async () => {
  for (const variant of ["absent", "old-job", "matching"]) {
    const st = await store(),
      q = new PublicationQueueService(st),
      start = new Date(Date.now() - 2000).toISOString();
    await st.transact((s) => {
      s.queue = [
        job("current", {
          status: "PUBLISHING",
          started_at: start,
          attempts: 1,
          attempt_history: [
            {
              number: 1,
              started_at: start,
              finished_at: null,
              outcome: null,
              publish_clicked: true,
            },
          ],
        }),
      ];
      s.locks[account] = { job_id: "current", acquired_at: start };
    });
    const result = await q.finish("current", "SUCCESS", {
      publish_clicked: true,
      published_at: new Date().toISOString(),
      confirmation:
        variant === "absent"
          ? undefined
          : {
              job_id: variant === "old-job" ? "old" : "current",
              media_hash: "hash",
              positive_evidence:
                "Acknowledgement specific to current test job (MOCK)",
            },
    });
    assert.equal(
      result.status,
      variant === "matching" ? "SUCCESS" : "INCONCLUSIVE",
    );
  }
});
test("estado persistido danificado não perde fila silenciosamente", async () => {
  const file = join(await mkdtemp("/tmp/admin-invalid-state-"), "ops.json"),
    s = initialOperationsState();
  s.queue = [{ id: "partial" }];
  await writeFile(file, JSON.stringify(s));
  await assert.rejects(new OperationsStorage(file).read(), /preservado/);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), s);
});
test("detector confiável compara handle com ou sem @, mantendo valor observado", async () => {
  const st = await store(),
    service = new InstagramAccountService(st, async () => ({
      username: "@PLANTAORIO",
      status: "OK",
    }));
  await service.configure(account, {
    expected_username: "plantaorio",
    display_name: "Plantão",
    enabled: true,
  });
  assert.equal((await service.detectCurrentAccount(account)).status, "OK");
  const result = await service.validateActiveAccount(account);
  assert.equal(result.match, true);
  assert.equal(result.detected, "@PLANTAORIO");
});
