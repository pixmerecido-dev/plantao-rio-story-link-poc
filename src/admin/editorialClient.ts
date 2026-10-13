import type {
  Account,
  QueueJob,
  OperationalEvent,
  AutomationSettings,
} from "./operationsDomain.js";
import type { StorySettings, PublicationJob } from "./domain.js";
import {
  articleLabel,
  UI_STATUS_LABELS,
  type UiRole,
  EditorialRequestError,
  accountVerificationFailureMessage,
} from "./editorialUi.js";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const node = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const when = (v: string | null | undefined) =>
  v
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(v))
    : "Não definido";
const badge = (status: string) =>
  `<span class="badge ${esc(status)}">${esc(UI_STATUS_LABELS[status] ?? "Em acompanhamento")}</span>`;
const field = (name: string, value: unknown) =>
  `<div><label>${esc(name)}</label><p>${esc(value)}</p></div>`;
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Admin-Request": "local" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok)
    throw new EditorialRequestError(
      r.status,
      typeof value.error === "string" ? value.error : "Não foi possível concluir.",
    );
  return value;
}
const notice = (text: string, error = false) => {
  node("notice").innerHTML =
    `<div class="notice${error ? " error" : ""}">${esc(text)}</div>`;
};
function fail() {
  notice(
    "Não foi possível concluir. Confira os dados e tente novamente. Os detalhes estão disponíveis para o administrador.",
    true,
  );
}
let generation = 0;
let publishedPage = 1,
  publishedSearch = "";
const active = (route: string, g: number) =>
  (location.hash.slice(1) || "dashboard") === route && g === generation;
type QueueData = {
  jobs: QueueJob[];
  accounts: Account[];
  engineConnected: boolean;
};
type Article = {
  id: string;
  article_url: string | null;
  article_title?: string;
  status: string;
  queue_status: string | null;
  detected_at: string;
  job_id: string | null;
  thumbnail_available: boolean;
  last_error: string | null;
};
type FeedData = {
  config: {
    enabled: boolean;
    url: string;
    poll_interval_seconds: number;
    auto_enqueue: boolean;
    account_id: string;
  };
  entries: Article[];
  last_checked_at: string | null;
  last_error: string | null;
};
function accountLabel(job: QueueJob | PublicationJob, accounts: Account[]) {
  const configured = accounts.find((a) => a.id === job.account_id);
  return job.instagram_username
    ? `@${job.instagram_username}`
    : configured?.expected_username
      ? `@${configured.expected_username}`
      : "Conta ainda não confirmada";
}
function storyCards(jobs: QueueJob[], accounts: Account[], role: UiRole) {
  return jobs.length
    ? `<div class="story-cards">${jobs
        .map((j) => {
          const pending =
            (j.status === "READY" && j.awaiting_operator) ||
            ["QUEUED", "SCHEDULED", "PAUSED"].includes(j.status);
          const retry =
            j.status === "FAILED" &&
            j.attempts > 0 &&
            j.attempt_history.length === j.attempts &&
            j.attempt_history.every(
              (a) => a.publish_clicked === false && a.finished_at,
            );
          const title = articleLabel(
            j.story_url,
            (j as QueueJob & { article_title?: string }).article_title,
          );
          const media = `/api/publications/${encodeURIComponent(j.id)}/media`;
          return `<article class="story-card"><div class="story-card-preview">${j.media_type === "IMAGE" ? `<a href="${media}" target="_blank" rel="noopener"><img src="${media}" alt="Story: ${esc(title)}" loading="lazy"></a>` : "<span>Prévia não disponível</span>"}</div><div class="story-card-body"><div class="story-card-top"><strong>${j.scheduled_at ? when(j.scheduled_at) : j.status === "READY" ? "Aguardando sua decisão" : "Sem horário marcado"}</strong>${badge(j.status)}</div><h3>${esc(title)}</h3><p class="muted">${esc(accountLabel(j, accounts))}</p><p class="muted">Recebida em ${when(j.created_at)} · ${j.attempts} tentativa(s)</p>${j.error_message ? '<div class="notice error">Este Story precisa de atenção. Confira os detalhes antes de tentar novamente.</div>' : ""}<div class="form-actions"><button class="button" disabled title="A publicação pelo painel ainda não está disponível">Publicar agora</button>${pending ? `<button class="button secondary" data-job-action="schedule" data-id="${j.id}">${j.scheduled_at ? "Editar horário" : "Agendar"}</button><button class="button secondary" data-job-action="${j.status === "PAUSED" ? "resume" : "pause"}" data-id="${j.id}">${j.status === "PAUSED" ? "Retomar" : "Pausar"}</button><button class="button secondary" data-job-action="cancel" data-id="${j.id}">Cancelar</button>` : ""}${j.status === "READY" && j.awaiting_operator ? `<button class="button secondary" data-job-action="enqueue" data-id="${j.id}">Enviar para fila</button>` : ""}${retry ? `<button class="button secondary" data-job-action="retry" data-id="${j.id}">Tentar novamente</button>` : ""}<a class="button secondary" href="${esc(j.story_url)}" target="_blank" rel="noopener noreferrer">Abrir matéria</a><button class="button secondary" data-story-detail="${j.id}">Ver detalhes</button></div></div></article>`;
        })
        .join("")}</div>`
    : '<div class="empty">Nenhum Story nesta lista.</div>';
}
async function showJob(id: string, role: UiRole) {
  const d = await api<{ job: QueueJob; events: OperationalEvent[] }>(
    `/api/operations/queue/${encodeURIComponent(id)}`,
  );
  const j = d.job;
  node("detail-content").innerHTML =
    `<div class="detail-head"><h2>${esc(articleLabel(j.story_url, (j as any).article_title))}</h2><button class="button secondary" id="editorial-close">Fechar</button></div>${badge(j.status)}<div class="detail-grid"><img class="detail-image" src="/api/publications/${encodeURIComponent(id)}/media" alt="Imagem do Story"><div><div class="detail-data">${field("Entrada", when(j.created_at))}${field("Publicação prevista", j.scheduled_at ? when(j.scheduled_at) : "Ainda não agendada")}${field("Tentativas", j.attempts)}${field("Texto do link", j.sticker_text)}</div><a class="button secondary" href="${esc(j.story_url)}" target="_blank" rel="noopener">Abrir matéria</a>${j.error_message ? '<p class="notice error">O envio precisa de conferência. Não repita a publicação sem confirmar o resultado.</p>' : ""}</div></div>${role === "ADMIN" ? `<details class="technical-details"><summary>Informações técnicas e logs</summary><pre class="safe-json">${esc(JSON.stringify(d, null, 2))}</pre></details>` : ""}`;
  node<HTMLButtonElement>("editorial-close").onclick = () =>
    node<HTMLDialogElement>("detail").close();
  node<HTMLDialogElement>("detail").showModal();
}
function wireStories(route: string, role: UiRole) {
  document
    .querySelectorAll<HTMLButtonElement>("[data-story-detail]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          void showJob(b.dataset.storyDetail!, role).catch(fail)),
    );
  document.querySelectorAll<HTMLButtonElement>("[data-job-action]").forEach(
    (b) =>
      (b.onclick = () =>
        void (async () => {
          try {
            const action = b.dataset.jobAction!;
            let scheduled_at;
            if (action === "schedule") {
              const input = prompt(
                "Quando publicar? Data e hora do seu computador (AAAA-MM-DDTHH:mm).",
              );
              if (!input) return;
              const date = new Date(input);
              if (!Number.isFinite(date.getTime())) {
                notice("Informe uma data e hora válidas.", true);
                return;
              }
              scheduled_at = date.toISOString();
            }
            if (
              action === "cancel" &&
              !confirm(
                "Cancelar este Story? A matéria continuará no histórico.",
              )
            )
              return;
            b.disabled = true;
            await api(
              `/api/operations/queue/${encodeURIComponent(b.dataset.id!)}/${action}`,
              "POST",
              { scheduled_at },
            );
            if (location.hash.slice(1) === route) {
              await renderEditorialRoute(route, role);
              notice("Story atualizado. Nenhuma publicação foi executada.");
            }
          } catch {
            b.disabled = false;
            fail();
          }
        })()),
  );
}
function alertCards(jobs: QueueJob[], accounts: Account[], feed?: FeedData) {
  const items: string[] = [];
  for (const a of accounts) {
    if (a.status === "MISMATCH")
      items.push(
        `<div class="alert-card error"><strong>Outra conta do Instagram está conectada</strong><p>Esperado: @${esc(a.expected_username)} · Encontrado: @${esc(a.detected_username)}</p><a href="#accounts">Verificar conta</a></div>`,
      );
    else if (["UNKNOWN", "UNAVAILABLE", "LOGGED_OUT"].includes(a.status))
      items.push(
        '<div class="alert-card"><strong>Confirme sua conta do Instagram</strong><p>Antes de publicar, precisamos verificar a conta conectada.</p><a href="#accounts">Verificar conta</a></div>',
      );
  }
  for (const j of jobs
    .filter((j) =>
      ["FAILED", "INCONCLUSIVE", "REQUIRES_REVIEW"].includes(j.status),
    )
    .slice(0, 8))
    items.push(
      `<div class="alert-card error"><strong>${j.status === "FAILED" ? "O Story não foi concluído" : "Publicação não confirmada"}</strong><p>${esc(articleLabel(j.story_url, (j as any).article_title))}</p><a href="#queue">Conferir Story na fila</a></div>`,
    );
  for (const e of feed?.entries
    .filter((e) =>
      [
        "MEDIA_DOWNLOAD_FAILED",
        "MEDIA_INVALID",
        "MEDIA_NOT_FOUND",
        "ARTICLE_RESOLVE_FAILED",
      ].includes(e.status),
    )
    .slice(0, 5) ?? [])
    items.push(
      `<div class="alert-card error"><strong>${e.status === "ARTICLE_RESOLVE_FAILED" ? "Não foi possível abrir a matéria" : "Não foi possível preparar a imagem"}</strong><p>${esc(articleLabel(e.article_url ?? "", e.article_title))}</p><a href="#feed">Conferir matéria</a></div>`,
    );
  if (feed?.last_error)
    items.push(
      '<div class="alert-card error"><strong>A leitura de novas matérias está indisponível</strong><p>Tentaremos novamente na próxima leitura.</p><a href="#feed">Consultar novamente</a></div>',
    );
  return (
    items.join("") ||
    '<div class="empty">Tudo em ordem. Nenhum alerta no momento.</div>'
  );
}
export async function renderEditorialRoute(route: string, role: UiRole) {
  const g = ++generation;
  if (route === "dashboard" || route === "queue" || route === "alerts") {
    const [data, feed] = await Promise.all([
      api<QueueData>("/api/operations/queue"),
      api<FeedData>("/api/feed"),
    ]);
    if (!active(route, g)) return;
    if (route === "queue") {
      node("content").innerHTML =
        `<p class="subtext">Organize seus Stories. A publicação pelo painel ainda não está disponível.</p><div class="filters"><label>Mostrar <select id="editorial-queue-filter"><option value="pending">Próximos Stories</option><option value="all">Todos</option><option value="errors">Precisam de atenção</option></select></label><a href="#feed" class="button secondary">Ver novas matérias</a></div><div id="editorial-stories"></div>`;
      const render = () => {
        const value = node<HTMLSelectElement>("editorial-queue-filter").value;
        const jobs = data.jobs.filter(
          (j) =>
            value === "all" ||
            (value === "errors"
              ? ["FAILED", "INCONCLUSIVE", "REQUIRES_REVIEW"].includes(j.status)
              : [
                  "READY",
                  "QUEUED",
                  "SCHEDULED",
                  "PAUSED",
                  "PREPARING",
                  "PUBLISHING",
                ].includes(j.status)),
        );
        node("editorial-stories").innerHTML = storyCards(
          jobs,
          data.accounts,
          role,
        );
        wireStories(route, role);
      };
      node<HTMLSelectElement>("editorial-queue-filter").onchange = render;
      render();
      return;
    }
    if (route === "alerts") {
      node("content").innerHTML =
        `<p class="subtext">O que precisa da sua atenção.</p><section class="alerts-grid">${alertCards(data.jobs, data.accounts, feed)}</section>`;
      return;
    }
    const [dashboard, latestPublished] = await Promise.all([
      api<any>("/api/dashboard"),
      api<{ items: PublicationJob[] }>("/api/publications?status=SUCCESS"),
    ]);
    if (!active(route, g)) return;
    const pending = data.jobs.filter((j) =>
      ["READY", "QUEUED", "SCHEDULED", "PAUSED"].includes(j.status),
    );
    const scheduled = pending
      .filter((j) => j.scheduled_at && j.status === "SCHEDULED")
      .sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!))[0];
    const expected = data.accounts[0];
    const cards = [
      ["Stories hoje", dashboard.stats.today],
      ["Na fila", pending.length],
      [
        "Próxima publicação",
        scheduled ? when(scheduled.scheduled_at) : "Sem horário marcado",
      ],
      [
        "Erros",
        data.jobs.filter((j) =>
          ["FAILED", "INCONCLUSIVE", "REQUIRES_REVIEW"].includes(j.status),
        ).length,
      ],
      [
        "Conta",
        expected?.status === "OK"
          ? `@${expected.detected_username} ✓`
          : expected?.expected_username
            ? `@${expected.expected_username} · confirmar`
            : "Ainda não cadastrada",
      ],
    ];
    node("content").innerHTML =
      `<p class="subtext">Acompanhe o que entrou e o que vem a seguir.</p><div class="stats-grid editorial-stats">${cards.map(([label, value]) => `<div class="stat-card"><div class="label">${esc(label)}</div><strong>${esc(value)}</strong></div>`).join("")}</div><section class="panel"><div class="panel-heading"><h2>Próximos Stories</h2><a href="#queue">Ver toda a fila →</a></div>${storyCards(pending.slice(0, 4), data.accounts, role)}</section><section class="panel"><div class="panel-heading"><h2>Últimas publicações</h2><a href="#publications">Ver publicados →</a></div>${publishedCards(
        latestPublished.items.slice(0, 5),
        data.accounts,
      )}</section><section class="panel"><h2>Alertas</h2>${alertCards(data.jobs, data.accounts, feed)}</section>`;
    wireStories(route, role);
    wirePublishedDetails(role);
    return;
  }
  if (route === "feed") {
    const data = await api<FeedData>("/api/feed");
    if (!active(route, g)) return;
    node("content").innerHTML =
      `<p class="subtext">Matérias recebidas do Plantão Rio, com a imagem do Story pronta.</p><div class="form-actions"><button id="editorial-feed-refresh" class="button secondary">Buscar novas matérias</button><a href="#queue" class="button secondary">Ver fila de Stories</a></div><p class="muted">Última leitura: ${when(data.last_checked_at)}</p><div class="article-grid">${data.entries.map((e) => `<article class="article-card">${e.thumbnail_available ? `<img src="/api/feed/entries/${encodeURIComponent(e.id)}/thumbnail" alt="Imagem pronta da matéria" loading="lazy">` : '<div class="article-placeholder">Imagem em preparação</div>'}<div><h3>${esc(articleLabel(e.article_url ?? "", e.article_title))}</h3><p class="muted">Recebida em ${when(e.detected_at)}</p>${badge(e.queue_status ?? e.status)}<div class="form-actions">${e.status === "READY" && (!e.queue_status || e.queue_status === "READY") ? `<button class="button" data-article-action="enqueue" data-id="${e.id}">Enviar para fila</button><button class="button secondary" data-article-action="ignore" data-id="${e.id}">Ignorar</button>` : ""}${!e.job_id && ["ARTICLE_RESOLVE_FAILED", "MEDIA_DOWNLOAD_FAILED", "MEDIA_INVALID", "MEDIA_NOT_FOUND"].includes(e.status) ? `<button class="button" data-article-action="retry" data-id="${e.id}">Tentar novamente</button>` : ""}${e.article_url ? `<a class="button secondary" href="${esc(e.article_url)}" target="_blank" rel="noopener">Abrir matéria</a>` : ""}</div></div></article>`).join("") || '<div class="empty">As novas matérias aparecerão aqui.</div>'}</div>`;
    const execute = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        if (location.hash.slice(1) === route)
          await renderEditorialRoute(route, role);
      } catch {
        fail();
      }
    };
    node<HTMLButtonElement>("editorial-feed-refresh").onclick = () =>
      void execute(async () => {
        const result = await api<{ error?: string }>(
          "/api/feed/check",
          "POST",
          {},
        );
        if (result.error) throw Error(result.error);
      });
    document
      .querySelectorAll<HTMLButtonElement>("[data-article-action]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            b.disabled = true;
            void execute(() =>
              api(
                `/api/feed/entries/${b.dataset.id}/${b.dataset.articleAction}`,
                "POST",
                {},
              ),
            );
          }),
      );
    return;
  }
  if (route === "automation") {
    const data = await api<{
      publishing: AutomationSettings;
      safety: { pause_on_system_failure: boolean };
    }>("/api/operations/automation");
    if (!active(route, g)) return;
    const p = data.publishing;
    node("content").innerHTML =
      `<p class="subtext">Planeje quando seus Stories devem sair. Publicação pelo painel ainda desativada.</p><section class="panel"><h2>Ritmo de publicação</h2><p>${p.enabled ? `${p.max_per_hour} Stories por hora, até ${p.max_per_day} por dia, entre ${p.window_start} e ${p.window_end}.` : "Organização manual da fila. Você decide quando agendar."}</p><form id="editorial-agenda" class="ops-form admin-only"><label>Modo de publicação<select id="agenda-mode"><option value="QUEUE_ONLY" ${!p.enabled ? "selected" : ""}>Apenas organizar a fila</option><option value="IMMEDIATE" ${p.enabled && p.mode === "IMMEDIATE" ? "selected" : ""}>Assim que a matéria estiver pronta</option><option value="INTERVAL" ${p.enabled && p.mode === "INTERVAL" ? "selected" : ""}>Distribuir ao longo do dia por intervalo</option><option value="RATE" ${p.enabled && p.mode === "RATE" ? "selected" : ""}>Distribuir ao longo do dia por quantidade</option></select></label><label>Stories por hora<input id="agenda-rate" type="number" min="1" max="60" value="${p.max_per_hour}"></label><label>Minutos entre Stories<input id="agenda-interval" type="number" min="1" max="10080" value="${p.interval_minutes}"></label><label>Limite diário<input id="agenda-daily" type="number" min="1" max="1000" value="${p.max_per_day}"></label><label>Publicar a partir de<input id="agenda-start" type="time" value="${p.window_start}"></label><label>Até<input id="agenda-end" type="time" value="${p.window_end}"></label><button class="button">Salvar agenda</button></form><p class="info">Essas preferências não publicam Stories nem aprovam matérias aguardando sua decisão.</p></section><section class="panel"><h2>Próximos horários</h2><div id="agenda-list"></div></section>`;
    const q = await api<QueueData>("/api/operations/queue");
    if (!active(route, g)) return;
    node("agenda-list").innerHTML = storyCards(
      q.jobs
        .filter((j) => j.status === "SCHEDULED")
        .sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!)),
      q.accounts,
      role,
    );
    wireStories(route, role);
    node<HTMLFormElement>("editorial-agenda").onsubmit = (e) => {
      e.preventDefault();
      void (async () => {
        try {
          const mode = node<HTMLSelectElement>("agenda-mode").value;
          await api("/api/operations/automation", "PUT", {
            publishing: {
              ...p,
              enabled: mode !== "QUEUE_ONLY",
              mode: mode === "QUEUE_ONLY" ? p.mode : mode,
              max_per_hour: Number(node<HTMLInputElement>("agenda-rate").value),
              interval_minutes: Number(
                node<HTMLInputElement>("agenda-interval").value,
              ),
              max_per_day: Number(node<HTMLInputElement>("agenda-daily").value),
              window_start: node<HTMLInputElement>("agenda-start").value,
              window_end: node<HTMLInputElement>("agenda-end").value,
            },
            safety: data.safety,
          });
          notice("Agenda salva. Nenhuma publicação foi executada.");
        } catch {
          fail();
        }
      })();
    };
    return;
  }
  if (route === "accounts") {
    const accounts = await api<Account[]>("/api/operations/accounts");
    if (!active(route, g)) return;
    let a = accounts[0];
    const lifecycle = await api<{ account_confirmed: boolean }>(
      "/api/runtime",
    ).catch(() => null);
    if (!active(route, g)) return;
    if (a?.status === "OK" && lifecycle && !lifecycle.account_confirmed)
      a = { ...a, status: "UNKNOWN" };
    node("content").innerHTML =
      `<section class="panel account-panel"><h2>Instagram</h2><p><strong>Conta esperada:</strong> ${a?.expected_username ? "@" + esc(a.expected_username) : "Cadastre sua conta"}</p>${badge(a?.status ?? "UNKNOWN")}<p>Conta detectada: ${a?.detected_username ? "@" + esc(a.detected_username) : "Ainda não confirmada"}</p><p class="muted">Última verificação: ${when(a?.detected_at)}</p>${a?.status === "MISMATCH" ? `<div class="notice error">Outra conta do Instagram está conectada. Esperado: @${esc(a.expected_username)}. Encontrado: @${esc(a.detected_username)}. Publicação bloqueada.</div>` : ""}<p class="notice">${a?.status === "OK" && a?.enabled ? "Conta confirmada ✓" : "Publicação bloqueada até a confirmação da conta do Instagram."}</p><p><a href="#system">Preparar sistema</a> antes da verificação, se necessário.</p><button id="editorial-account-check" class="button">Verificar conta</button> <button id="editorial-account-refresh" class="button secondary">Atualizar status</button>${role === "ADMIN" ? `<form class="ops-form" id="editorial-account-form"><label>Conta esperada<input id="account-expected" placeholder="@plantaorio" value="${esc(a?.expected_username)}" required></label><label>Nome da conta<input id="account-display" value="${esc(a?.display_name)}" maxlength="80" required></label><button class="button secondary">Salvar conta</button></form>` : '<p class="muted">Peça ao administrador para alterar a conta cadastrada.</p>'}</section><section class="panel"><h2>Facebook Story</h2><p>Vínculo ainda não confirmado.</p><p class="muted">A escolha de compartilhar no Facebook será conferida no Instagram. Não presumimos que o Story foi entregue.</p></section>`;
    node<HTMLButtonElement>("editorial-account-refresh").onclick = () =>
      void renderEditorialRoute(route, role).catch(fail);
    node<HTMLButtonElement>("editorial-account-check").onclick = () =>
      void (async () => {
        const b = node<HTMLButtonElement>("editorial-account-check");
        b.disabled = true;
        try {
          const result = await api<Account>(
            "/api/operations/account/detect",
            "POST",
            {},
          );
          await renderEditorialRoute(route, role);
          notice(
            result.status === "OK"
              ? "Conta confirmada."
              : result.status === "MISMATCH"
                ? "Outra conta está conectada. Publicação bloqueada."
                : result.status === "UNKNOWN" && result.verification_message
                  ? result.verification_message
                  : "Não foi possível confirmar a conta. Abra o Instagram no computador e tente novamente.",
            result.status !== "OK",
          );
        } catch (error) {
          b.disabled = false;
          notice(accountVerificationFailureMessage(error), true);
        }
      })();
    if (role === "ADMIN")
      node<HTMLFormElement>("editorial-account-form").onsubmit = (e) => {
        e.preventDefault();
        void (async () => {
          try {
            await api("/api/operations/account", "PUT", {
              expected_username:
                node<HTMLInputElement>("account-expected").value,
              display_name: node<HTMLInputElement>("account-display").value,
              enabled: a?.enabled ?? true,
            });
            await renderEditorialRoute(route, role);
            notice(
              "Conta cadastrada. Verifique a conta conectada antes de publicar.",
            );
          } catch {
            fail();
          }
        })();
      };
    return;
  }
  if (route === "publications") {
    const [data, accounts] = await Promise.all([
      api<{
        items: PublicationJob[];
        page: number;
        total: number;
        pageSize: number;
      }>(
        `/api/publications?status=SUCCESS&page=${publishedPage}&q=${encodeURIComponent(publishedSearch)}`,
      ),
      api<Account[]>("/api/operations/accounts"),
    ]);
    if (!active(route, g)) return;
    node("content").innerHTML =
      `<p class="subtext">Stories com publicação confirmada. Envios que precisam de conferência aparecem em Alertas.</p><form id="published-search-form" class="filters"><input id="published-search" value="${esc(publishedSearch)}" placeholder="Buscar matéria" maxlength="200"><button class="button secondary">Buscar</button></form><section class="panel">${publishedCards(data.items, accounts)}</section><div class="form-actions"><button id="published-prev" class="button secondary" ${publishedPage <= 1 ? "disabled" : ""}>Anterior</button><span>Página ${publishedPage}</span><button id="published-next" class="button secondary" ${publishedPage * data.pageSize >= data.total ? "disabled" : ""}>Próxima</button></div>`;
    node<HTMLFormElement>("published-search-form").onsubmit = (e) => {
      e.preventDefault();
      publishedSearch = node<HTMLInputElement>("published-search").value;
      publishedPage = 1;
      void renderEditorialRoute(route, role);
    };
    node<HTMLButtonElement>("published-prev").onclick = () => {
      publishedPage--;
      void renderEditorialRoute(route, role);
    };
    node<HTMLButtonElement>("published-next").onclick = () => {
      publishedPage++;
      void renderEditorialRoute(route, role);
    };
    wirePublishedDetails(role);
    return;
  }
  if (route === "configuration" && role === "ADMIN") {
    const data = await api<FeedData>("/api/feed");
    if (!active(route, g)) return;
    const c = data.config;
    node("content").innerHTML =
      `<section class="panel"><h2>Fonte de matérias</h2><p class="muted">Configuração administrativa da leitura do site.</p><form class="ops-form" id="editorial-source-form"><label class="check"><input id="source-enabled" type="checkbox" ${c.enabled ? "checked" : ""}>Receber novas matérias</label><label>Endereço do RSS<input id="source-url" type="url" value="${esc(c.url)}" required></label><label>Intervalo de leitura (segundos)<input id="source-interval" type="number" min="10" max="86400" value="${c.poll_interval_seconds}"></label><label class="check"><input id="source-auto" type="checkbox" ${c.auto_enqueue ? "checked" : ""}>Enviar diretamente para fila</label><button class="button">Salvar fonte</button></form></section><section class="panel"><h2>Avançado</h2><div class="form-actions"><a class="button secondary" href="#system">Status do agente e diagnóstico</a><a class="button secondary" href="#logs">Logs técnicos</a><a class="button secondary" href="#accounts">Gerenciar contas</a><a class="button secondary" href="#queue-tools">Teste de fila</a><a class="button secondary" href="#agenda-tools">Políticas e calendário avançados</a></div><p class="muted">Integrações, identificação da conta e diagnóstico ficam nesta área.</p><div id="account-selector-setup"></div></section>`;
    const observedAccounts = await api<
      (Account & {
        verification_candidates?: { resource_id: string; text: string }[];
      })[]
    >("/api/operations/accounts");
    if (!active(route, g)) return;
    const observed = observedAccounts[0]?.verification_candidates ?? [];
    node("account-selector-setup").innerHTML =
      `<h3>Identificação da conta</h3><p>Depois de Verificar conta, escolha o nome que aparece no topo do próprio perfil, se houver mais de uma opção.</p>${observed.length ? `<select id="account-observed-name">${observed.map((c) => `<option value="${esc(c.resource_id)}">${esc(c.text)}</option>`).join("")}</select><button id="account-observed-save" class="button secondary">Usar este nome do perfil</button>` : '<a class="button secondary" href="#accounts">Verificar conta primeiro</a>'}`;
    if (observed.length)
      node<HTMLButtonElement>("account-observed-save").onclick = () =>
        void (async () => {
          try {
            await api("/api/operations/account/selector", "PUT", {
              resource_id: node<HTMLSelectElement>("account-observed-name")
                .value,
            });
            notice("Nome do perfil escolhido. Verifique a conta novamente.");
          } catch {
            fail();
          }
        })();
    node<HTMLFormElement>("editorial-source-form").onsubmit = (e) => {
      e.preventDefault();
      void (async () => {
        try {
          await api("/api/feed/config", "PUT", {
            ...c,
            enabled: node<HTMLInputElement>("source-enabled").checked,
            url: node<HTMLInputElement>("source-url").value,
            poll_interval_seconds: Number(
              node<HTMLInputElement>("source-interval").value,
            ),
            auto_enqueue: node<HTMLInputElement>("source-auto").checked,
          });
          notice("Fonte de matérias salva.");
        } catch {
          fail();
        }
      })();
    };
    return;
  }
}
function publishedCards(jobs: PublicationJob[], accounts: Account[]) {
  return jobs.length
    ? `<div class="published-grid">${jobs.map((j) => `<article class="published-card"><img src="/api/publications/${encodeURIComponent(j.id)}/media" alt="Story publicado" loading="lazy"><div><h3>${esc(articleLabel(j.story_url, (j as any).article_title))}</h3><p>Publicado com sucesso</p><p>${j.published_at ? when(j.published_at) : `Registro de ${when(j.finished_at)}`} · ${esc(accountLabel(j, accounts))}</p><div class="form-actions"><a class="button secondary" href="${esc(j.story_url)}" target="_blank" rel="noopener">Abrir matéria</a><button class="button secondary" data-published-detail="${j.id}">Ver detalhes</button><button class="button secondary" disabled title="O endereço deste Story não foi registrado">Abrir Story</button></div></div></article>`).join("")}</div>`
    : '<div class="empty">Nenhum Story publicado e confirmado ainda.</div>';
}

function wirePublishedDetails(role: UiRole) {
  document
    .querySelectorAll<HTMLButtonElement>("[data-published-detail]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          void (async () => {
            try {
              const d = await api<any>(
                `/api/publications/${b.dataset.publishedDetail}`,
              );
              node("detail-content").innerHTML =
                `<div class="detail-head"><h2>Publicado com sucesso</h2><button id="published-close" class="button secondary">Fechar</button></div><p>${when(d.job.published_at)}</p><img class="detail-image" src="/api/publications/${d.job.id}/media" alt="Story publicado">${role === "ADMIN" ? `<details><summary>Informações técnicas</summary><pre class="safe-json">${esc(JSON.stringify(d, null, 2))}</pre></details>` : ""}`;
              node<HTMLButtonElement>("published-close").onclick = () =>
                node<HTMLDialogElement>("detail").close();
              node<HTMLDialogElement>("detail").showModal();
            } catch {
              fail();
            }
          })()),
    );
}
