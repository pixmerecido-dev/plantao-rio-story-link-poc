import type { IncomingMessage, ServerResponse } from "node:http";
import type { OperationsRepository } from "./operationsStorage.js";
import {
  PublicationQueueService,
  PublishingScheduler,
  PublishingPolicyService,
  InstagramAccountService,
  SystemHealthService,
  PublicationLogService,
  orderedJobs,
} from "./operationalServices.js";
import type { PublicationJob } from "./domain.js";
import { ValidationError } from "./domain.js";
import {
  DEFAULT_ACCOUNT_ID,
  type QueueJob,
  type Health,
} from "./operationsDomain.js";
function displayQueue(jobs: QueueJob[]) {
  const group = (j: QueueJob) =>
    ["PREPARING", "READY", "PUBLISHING"].includes(j.status)
      ? 0
      : ["QUEUED", "SCHEDULED"].includes(j.status)
        ? 1
        : j.status === "PAUSED"
          ? 2
          : 3;
  const priority = { URGENT: 0, HIGH: 1, NORMAL: 2 };
  return [...jobs].sort(
    (a, b) =>
      group(a) - group(b) ||
      (group(a) === 1
        ? priority[a.priority] - priority[b.priority] || a.order - b.order
        : b.created_at.localeCompare(a.created_at)),
  );
}
export function publicJob(j: QueueJob) {
  const { media_path, ...safe } = j;
  return safe;
}
export function createOperationsApi(
  store: OperationsRepository,
  testMedia: string,
  history?: () => Promise<PublicationJob[]>,
) {
  const queue = new PublicationQueueService(store),
    accounts = new InstagramAccountService(store),
    health = new SystemHealthService(store),
    logs = new PublicationLogService(store),
    scheduler = new PublishingScheduler(queue, new PublishingPolicyService());
  let lastHealth: Health[] = [],
    checkedAt = 0,
    inflight: Promise<Health[]> | null = null;
  async function check(force = false) {
    if (!force && Date.now() - checkedAt < 10000) return lastHealth;
    if (inflight) return inflight;
    inflight = health
      .check()
      .then((h) => {
        lastHealth = h;
        checkedAt = Date.now();
        return h;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }
  async function summary() {
    const s = await store.read(),
      h = await check();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
    }).format(new Date());
    const publishedToday = s.queue.filter(
      (j) =>
        j.status === "SUCCESS" &&
        j.published_at &&
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
        }).format(new Date(j.published_at)) === today,
    ).length;
    return {
      system: s.system,
      accounts: s.instagram_accounts,
      health: h,
      publishing: s.publishing,
      safety: s.safety,
      queue_count: s.queue.filter((j) =>
        ["QUEUED", "SCHEDULED", "PAUSED"].includes(j.status),
      ).length,
      published_today: publishedToday,
      next_job: orderedJobs(s)[0] ? publicJob(orderedJobs(s)[0]!) : null,
      engineConnected: false,
      decisions: await scheduler.inspect(new Date(), h),
    };
  }
  return {
    queue,
    summary,
    async tick() {
      return scheduler.tick(new Date(), await check());
    },
    async handle(
      req: IncomingMessage,
      res: ServerResponse,
      url: URL,
      body: (req: IncomingMessage) => Promise<any>,
      send: (res: ServerResponse, v: unknown, status?: number) => void,
    ) {
      const path = url.pathname,
        method = req.method;
      if (!path.startsWith("/api/operations")) return false;
      const payload = async () => {
        const v = await body(req);
        if (!v || typeof v !== "object" || Array.isArray(v))
          throw new ValidationError("Objeto JSON obrigatório.");
        return v;
      };
      if (method === "GET" && path === "/api/operations") {
        send(res, await summary());
        return true;
      }
      if (method === "GET" && path === "/api/operations/queue") {
        const s = await store.read();
        send(res, {
          jobs: displayQueue(s.queue).map(publicJob),
          decisions: await scheduler.inspect(new Date(), await check()),
        });
        return true;
      }
      if (method === "POST" && path === "/api/operations/queue") {
        const v = await payload();
        send(
          res,
          publicJob(
            await queue.enqueueJob({
              account_id: DEFAULT_ACCOUNT_ID,
              media_path: testMedia,
              story_url: v.story_url,
              sticker_text: v.sticker_text,
              priority: v.priority,
              mode: v.mode,
              scheduled_at: v.scheduled_at,
            }),
          ),
          201,
        );
        return true;
      }
      const jobMatch =
        /^\/api\/operations\/queue\/([^/]+)(?:\/(pause|resume|cancel|top|publish-now|schedule))?$/.exec(
          path,
        );
      if (jobMatch) {
        const id = decodeURIComponent(jobMatch[1]!);
        if (method === "GET" && !jobMatch[2]) {
          const s = await store.read(),
            j = s.queue.find((j) => j.id === id);
          if (!j) throw new ValidationError("Job não encontrado.");
          send(res, {
            job: publicJob(j),
            events: s.events.filter((e) => e.job_id === id),
          });
          return true;
        }
        if (method === "POST" && jobMatch[2]) {
          const v = await payload();
          send(
            res,
            publicJob(
              await queue.action(
                id,
                jobMatch[2] as Parameters<typeof queue.action>[1],
                v.scheduled_at,
              ),
            ),
          );
          return true;
        }
      }
      if (method === "GET" && path === "/api/operations/automation") {
        const s = await store.read();
        send(res, { publishing: s.publishing, safety: s.safety });
        return true;
      }
      if (method === "PUT" && path === "/api/operations/automation") {
        const v = await payload();
        send(
          res,
          await queue.saveAutomation(
            v.publishing,
            v.safety?.pause_on_system_failure,
          ),
        );
        return true;
      }
      if (method === "POST" && path === "/api/operations/system") {
        const v = await payload();
        if (!["ONLINE", "PAUSED"].includes(v.status))
          throw new ValidationError("Estado inválido.");
        send(res, await queue.setSystem(v.status));
        return true;
      }
      if (method === "POST" && path === "/api/operations/next") {
        await payload();
        send(res, await scheduler.tick(new Date(), await check(true)));
        return true;
      }
      if (method === "GET" && path === "/api/operations/accounts") {
        send(res, (await store.read()).instagram_accounts);
        return true;
      }
      if (method === "PUT" && path === "/api/operations/account") {
        send(
          res,
          await accounts.configure(DEFAULT_ACCOUNT_ID, await payload()),
        );
        return true;
      }
      if (method === "POST" && path === "/api/operations/account/detect") {
        await payload();
        send(res, await accounts.detectCurrentAccount(DEFAULT_ACCOUNT_ID));
        return true;
      }
      if (method === "GET" && path === "/api/operations/account/settings") {
        send(res, {
          account_id: DEFAULT_ACCOUNT_ID,
          settings: (await store.read()).account_settings[DEFAULT_ACCOUNT_ID],
        });
        return true;
      }
      if (method === "GET" && path === "/api/operations/health") {
        send(res, await check(true));
        return true;
      }
      if (method === "GET" && path === "/api/operations/logs") {
        send(res, {
          events: await logs.list(url.searchParams.get("job_id") ?? undefined),
          audit: await logs.audit(),
        });
        return true;
      }
      if (method === "GET" && path === "/api/operations/calendar") {
        const from = url.searchParams.get("from"),
          to = url.searchParams.get("to");
        if (
          !from ||
          !to ||
          !Number.isFinite(Date.parse(from)) ||
          !Number.isFinite(Date.parse(to)) ||
          Date.parse(to) < Date.parse(from) ||
          Date.parse(to) - Date.parse(from) > 366 * 86400000
        )
          throw new ValidationError("Intervalo inválido (máximo 366 dias).");
        const s = await store.read();
        const historical = history ? await history() : [];
        const all = [
          ...s.queue,
          ...historical.map((j) => ({
            ...j,
            scheduled_at: null,
            priority: j.priority ?? "—",
            mode: j.mode ?? "—",
          })),
        ];
        send(
          res,
          all
            .filter((j) => {
              const t = Date.parse(
                j.published_at ??
                  j.scheduled_at ??
                  j.started_at ??
                  j.created_at,
              );
              return t >= Date.parse(from) && t < Date.parse(to);
            })
            .sort((a, b) =>
              (a.published_at ?? a.scheduled_at ?? a.created_at).localeCompare(
                b.published_at ?? b.scheduled_at ?? b.created_at,
              ),
            )
            .map((j) => {
              const { media_path, ...safe } = j;
              return safe;
            }),
        );
        return true;
      }
      send(res, { error: "Recurso operacional não disponível." }, 404);
      return true;
    },
  };
}
