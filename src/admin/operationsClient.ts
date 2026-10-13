import type {
  Account,
  QueueJob,
  Health,
  AutomationSettings,
  OperationsState,
  OperationalEvent,
  Audit,
} from "./operationsDomain.js";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const date = (v: string | null) =>
  v
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(v))
    : "—";
const node = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  namespace = "/api/operations",
): Promise<T> {
  const r = await fetch(namespace + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Admin-Request": "local" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error ?? "Operação não concluída.");
  return v;
}
const badge = (s: string) => `<span class="badge ${esc(s)}">${esc(s)}</span>`;
const button = (text: string, action: string, extra = "") =>
  `<button class="button secondary" data-action="${action}" ${extra}>${text}</button>`;
const empty = (text: string) => `<div class="empty">${text}</div>`;
function note(text: string) {
  node("notice").innerHTML = `<div class="notice">${esc(text)}</div>`;
}
function fail(e: unknown) {
  node("notice").innerHTML =
    `<div class="notice error">${esc(e instanceof Error ? e.message : e)}</div>`;
}
type Summary = {
  system: OperationsState["system"];
  accounts: Account[];
  health: Health[];
  publishing: AutomationSettings;
  queue_count: number;
  published_today: number;
  next_job: QueueJob | null;
  engineConnected: boolean;
  decisions: {
    job_id: string;
    decision: {
      allowed: boolean;
      reason: string;
      nextEligibleAt: string | null;
    };
  }[];
};
function systemButtons() {
  return `${button("Pausar automação", "pause-system")}${button("Retomar automação", "resume-system")}${button("Publicar próximo", "next")}`;
}
function wireSystem(reload: () => Promise<void>) {
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((b) => {
    if (!["pause-system", "resume-system", "next"].includes(b.dataset.action!))
      return;
    b.onclick = () =>
      void (async () => {
        b.disabled = true;
        try {
          if (b.dataset.action === "next") {
            const result = await api<{ reason: string }>("/next", "POST", {});
            note(
              `Execução bloqueada: ${result.reason}. O motor não está conectado ao painel.`,
            );
          } else {
            await api("/system", "POST", {
              status: b.dataset.action === "pause-system" ? "PAUSED" : "ONLINE",
            });
            note(
              "Estado operacional atualizado. As travas de conta, saúde e adapter permanecem obrigatórias.",
            );
          }
          await reload();
        } catch (e) {
          fail(e);
        } finally {
          b.disabled = false;
        }
      })();
  });
}
export async function operationBanner() {
  const s = await api<Summary>("");
  const html = `<section class="panel operational-banner"><div class="panel-heading"><div><h2>POSTADOR ${badge(s.system.status)}</h2><p class="muted">${esc(s.system.reason ?? "Adapter de execução ainda não conectado.")}</p></div><a href="#system">Sistema →</a></div><div class="operational-grid"><div>Conta<strong>${esc(s.accounts[0]?.expected_username ? "@" + s.accounts[0].expected_username : "Não configurada")} ${badge(s.accounts[0]?.status ?? "UNKNOWN")}</strong></div>${s.health
    .filter((h) => ["APPIUM", "EMULATOR", "ADB"].includes(h.component))
    .map((h) => `<div>${h.component}<strong>${badge(h.status)}</strong></div>`)
    .join(
      "",
    )}<div>Fila<strong>${s.queue_count} jobs</strong></div><div>Próxima postagem<strong>${esc(s.next_job?.scheduled_at ? date(s.next_job.scheduled_at) : "Sem horário confirmado")}</strong></div><div>Publicadas hoje (fila)<strong>${s.published_today} / ${s.publishing.max_per_day}</strong></div></div><div class="form-actions">${systemButtons()}</div><p class="info">O painel organiza jobs e decisões. Não publica no Instagram nesta fase.</p></section>`;
  return {
    html,
    queueCount: s.queue_count,
    nextTime: s.next_job?.scheduled_at ? date(s.next_job.scheduled_at) : "—",
    wire: () =>
      wireSystem(async () => {
        node<HTMLButtonElement>("refresh").click();
      }),
  };
}
function rows(jobs: QueueJob[]) {
  return jobs.length
    ? `<div class="table-wrap"><table><thead><tr><th>Job / mídia</th><th>Conta</th><th>Prioridade</th><th>Modo</th><th>Horário</th><th>Status</th><th>Ações</th></tr></thead><tbody>${jobs
        .map(
          (j) =>
            `<tr><td><button class="job-link" data-detail="${esc(j.id)}">${esc(j.media_filename)}</button><small class="muted">${esc(j.job_id.slice(0, 8))}</small></td><td>${esc(j.instagram_username ?? j.account_id)}</td><td>${badge(j.priority)}</td><td>${esc(j.mode)}</td><td>${esc(date(j.scheduled_at))}</td><td>${badge(j.status)}</td><td>${
              ["QUEUED", "SCHEDULED", "PAUSED"].includes(j.status)
                ? `<div class="queue-actions">${(j.status === "PAUSED"
                    ? ["resume"]
                    : ["pause"]
                  )
                    .concat(["top", "schedule", "publish-now", "cancel"])
                    .map(
                      (a) =>
                        `<button class="preset" data-queue-id="${esc(j.id)}" data-queue-action="${a}">${esc({ resume: "Retomar", pause: "Pausar", top: "Topo", schedule: "Adiar", "publish-now": "Publicar agora", cancel: "Cancelar" }[a])}</button>`,
                    )
                    .join("")}</div>`
                : "Revisão / histórico"
            }</td></tr>`,
        )
        .join("")}</tbody></table></div>`
    : empty("Nenhum job neste filtro.");
}
function wireDetails() {
  document.querySelectorAll<HTMLButtonElement>("[data-detail]").forEach(
    (b) =>
      (b.onclick = () =>
        void (async () => {
          try {
            const d = await api<{ job: QueueJob; events: OperationalEvent[] }>(
              `${b.dataset.detailSource === "history" ? "" : "/queue"}/${encodeURIComponent(b.dataset.detail!)}`,
              "GET",
              undefined,
              b.dataset.detailSource === "history"
                ? "/api/publications"
                : "/api/operations",
            );
            node("detail-content").innerHTML =
              `<div class="detail-head"><h2>Detalhes do job</h2><button class="button secondary" id="ops-close">Fechar</button></div>${badge(d.job.status)}<div class="detail-data">${Object.entries(
                d.job,
              )
                .filter(
                  ([k]) =>
                    ![
                      "effective_settings",
                      "attempt_history",
                      "dedup_key",
                      "media_hash",
                    ].includes(k),
                )
                .map(
                  ([k, v]) =>
                    `<div><label>${esc(k)}</label><p>${esc(v ?? "—")}</p></div>`,
                )
                .join(
                  "",
                )}</div><h3>Configuração congelada</h3><pre class="safe-json">${esc(JSON.stringify(d.job.effective_settings, null, 2))}</pre><h3>Tentativas</h3><pre class="safe-json">${d.job.attempt_history ? esc(JSON.stringify(d.job.attempt_history, null, 2)) : "Registros detalhados indisponíveis no resumo histórico."}</pre><h3>Eventos</h3>${events(d.events)}`;
            node<HTMLButtonElement>("ops-close").onclick = () =>
              node<HTMLDialogElement>("detail").close();
            node<HTMLDialogElement>("detail").showModal();
          } catch (e) {
            fail(e);
          }
        })()),
  );
}
function events(list: OperationalEvent[]) {
  return list.length
    ? list
        .map(
          (e) =>
            `<div class="event-row"><time>${esc(date(e.timestamp))}</time><div><strong>${esc(e.event)}</strong><p>${esc(e.message)}</p><small class="muted">${esc(e.job_id)}</small></div></div>`,
        )
        .join("")
    : empty("Nenhum evento operacional.");
}
export async function operationalLogs() {
  const d = await api<{ events: OperationalEvent[]; audit: Audit[] }>("/logs");
  return `<section class="panel"><h2>Eventos operacionais</h2>${events(d.events.slice().reverse())}</section><section class="panel"><h2>Auditoria administrativa</h2>${
    d.audit.length
      ? d.audit
          .slice()
          .reverse()
          .map(
            (a) =>
              `<div class="event-row"><time>${esc(date(a.timestamp))}<br>${esc(a.user)}</time><div><strong>${esc(a.setting)}</strong><pre class="safe-json">${esc(JSON.stringify(a.old_value))} → ${esc(JSON.stringify(a.new_value))}</pre></div></div>`,
          )
          .join("")
      : empty("Nenhuma alteração administrativa.")
  }</section>`;
}
export async function renderOperations(route: string) {
  const content = node("content");
  if (route === "queue") {
    const data = await api<{
      jobs: QueueJob[];
      decisions: Summary["decisions"];
    }>("/queue");
    if (location.hash.slice(1) !== route) return;
    content.innerHTML = `<p class="subtext">Fila persistente por conta. “Publicar agora” apenas torna o job elegível; não executa o Instagram.</p><section class="panel"><h2>Adicionar job de teste</h2><form id="enqueue-form" class="ops-form"><label>URL da matéria<input id="queue-url" type="url" required value="https://plantaorio.com.br/"></label><label>Texto do sticker<input id="queue-text" required value="Leia a matéria completa"></label><label>Prioridade<select id="queue-priority"><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label><label>Modo<select id="queue-mode"><option>AUTO_QUEUE</option><option>IMMEDIATE</option><option>SCHEDULED</option><option>PAUSED</option></select></label><label>Agendamento (horário local do computador)<input id="queue-date" type="datetime-local"></label><button class="button">Adicionar à fila</button></form><p class="muted">Usa somente STORY_MEDIA / STORY_IMAGE configurada no backend ou assets/story-test.jpg. Entradas RSS são gerenciadas na tela Entradas RSS.</p></section><section class="panel"><div class="filters"><label>Visão <select id="queue-filter"><option value="all">Atual / todos</option><option value="scheduled">Agendados</option><option value="errors">Com erro / revisão</option></select></label></div><div id="queue-table">${rows(data.jobs)}</div></section><section class="panel"><h2>Decisões do scheduler</h2>${data.decisions.length ? data.decisions.map((d) => `<p><code>${esc(d.job_id.slice(0, 8))}</code> ${badge(d.decision.reason)} ${esc(date(d.decision.nextEligibleAt))}</p>`).join("") : empty("Nenhum job elegível para avaliação.")}</section>`;
    const wire = () => {
      wireDetails();
      document
        .querySelectorAll<HTMLButtonElement>("[data-queue-action]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              void (async () => {
                try {
                  const action = b.dataset.queueAction!;
                  let scheduled_at: string | undefined;
                  if (action === "schedule") {
                    const value = prompt(
                      "Adiar para data/hora local (AAAA-MM-DDTHH:mm):",
                    );
                    if (!value) return;
                    const date = new Date(value);
                    if (!Number.isFinite(date.getTime()))
                      throw Error("Data inválida.");
                    scheduled_at = date.toISOString();
                  }
                  if (
                    action === "cancel" &&
                    !confirm("Cancelar este job pendente?")
                  )
                    return;
                  await api(
                    `/queue/${encodeURIComponent(b.dataset.queueId!)}/${action}`,
                    "POST",
                    { scheduled_at },
                  );
                  note(
                    action === "publish-now"
                      ? "Job elegível; publicação real não executada."
                      : "Fila atualizada.",
                  );
                  await renderOperations("queue");
                } catch (e) {
                  fail(e);
                }
              })()),
        );
    };
    wire();
    node<HTMLSelectElement>("queue-filter").onchange = (e) => {
      const v = (e.target as HTMLSelectElement).value;
      node("queue-table").innerHTML = rows(
        data.jobs.filter(
          (j) =>
            v === "all" ||
            (v === "scheduled"
              ? j.status === "SCHEDULED"
              : [
                  "FAILED",
                  "INCONCLUSIVE",
                  "REQUIRES_REVIEW",
                  "DUPLICATE",
                ].includes(j.status)),
        ),
      );
      wire();
    };
    node<HTMLFormElement>("enqueue-form").onsubmit = (e) => {
      e.preventDefault();
      void (async () => {
        try {
          const value = node<HTMLInputElement>("queue-date").value;
          await api("/queue", "POST", {
            story_url: node<HTMLInputElement>("queue-url").value,
            sticker_text: node<HTMLInputElement>("queue-text").value,
            priority: node<HTMLSelectElement>("queue-priority").value,
            mode: node<HTMLSelectElement>("queue-mode").value,
            scheduled_at: value ? new Date(value).toISOString() : null,
          });
          note("Job persistido; duplicidade verificada por hash.");
          await renderOperations("queue");
        } catch (error) {
          fail(error);
        }
      })();
    };
    return;
  }
  if (route === "automation") {
    const { publishing: p, safety } = await api<{
      publishing: AutomationSettings;
      safety: OperationsState["safety"];
    }>("/automation");
    if (location.hash.slice(1) !== route) return;
    content.innerHTML = `<p class="subtext">Políticas de publicação e timeline. Horários da janela em Brasília; nenhum timer no frontend.</p><section class="panel"><h2>Automação de publicação</h2><form id="automation-form" class="ops-form"><label>Modo<select id="auto-mode">${["IMMEDIATE", "INTERVAL", "RATE"].map((m) => `<option ${p.mode === m ? "selected" : ""}>${m}</option>`).join("")}</select></label>${(["interval_minutes", "max_per_hour", "max_per_day", "min_interval_minutes", "max_attempts"] as const).map((k) => `<label>${esc({ interval_minutes: "Intervalo (minutos)", max_per_hour: "Máximo por hora", max_per_day: "Máximo diário", min_interval_minutes: "Intervalo mínimo (minutos)", max_attempts: "Máximo de tentativas" }[k])}<input id="auto-${k}" type="number" min="1" required value="${p[k]}"></label>`).join("")}<label>Início da janela<input id="auto-start" type="time" required value="${p.window_start}"></label><label>Fim da janela<input id="auto-end" type="time" required value="${p.window_end}"></label><label class="check"><input id="auto-enabled" type="checkbox" ${p.enabled ? "checked" : ""}>Automação habilitada</label><label class="check"><input id="auto-urgent" type="checkbox" ${p.allow_urgent_outside_window ? "checked" : ""}>Urgentes fora da janela</label><label class="check"><input id="auto-failure" type="checkbox" ${safety.pause_on_system_failure ? "checked" : ""}>Pausar em falha do sistema</label><button class="button">Salvar políticas</button></form></section><section class="panel"><h2>Calendário / timeline</h2><div class="filters"><select id="calendar-range"><option value="1">Hoje</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="custom">Personalizado</option></select><label>De <input id="calendar-from" type="date"></label><label>Até <input id="calendar-to" type="date"></label><button id="calendar-load" class="button secondary">Atualizar timeline</button></div><div id="calendar-timeline"></div></section>`;
    node<HTMLFormElement>("automation-form").onsubmit = (e) => {
      e.preventDefault();
      void (async () => {
        try {
          const updated = {
            ...p,
            mode: node<HTMLSelectElement>("auto-mode").value,
            window_start: node<HTMLInputElement>("auto-start").value,
            window_end: node<HTMLInputElement>("auto-end").value,
            enabled: node<HTMLInputElement>("auto-enabled").checked,
            allow_urgent_outside_window:
              node<HTMLInputElement>("auto-urgent").checked,
          };
          for (const k of [
            "interval_minutes",
            "max_per_hour",
            "max_per_day",
            "min_interval_minutes",
            "max_attempts",
          ] as const)
            updated[k] = Number(node<HTMLInputElement>("auto-" + k).value);
          await api("/automation", "PUT", {
            publishing: updated,
            safety: {
              pause_on_system_failure:
                node<HTMLInputElement>("auto-failure").checked,
            },
          });
          note("Políticas e auditoria salvas. Motor permanece desconectado.");
        } catch (error) {
          fail(error);
        }
      })();
    };
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    node<HTMLInputElement>("calendar-from").value = today;
    node<HTMLInputElement>("calendar-to").value = today;
    const loadCalendar = async () => {
      try {
        const range = node<HTMLSelectElement>("calendar-range").value;
        const from = new Date(
          node<HTMLInputElement>("calendar-from").value + "T00:00:00-03:00",
        );
        const to =
          range === "custom"
            ? new Date(
                node<HTMLInputElement>("calendar-to").value + "T00:00:00-03:00",
              )
            : new Date(from.getTime() + (Number(range) - 1) * 86400000);
        to.setTime(to.getTime() + 86400000);
        const jobs = await api<QueueJob[]>(
          `/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        );
        node("calendar-timeline").innerHTML = jobs.length
          ? jobs
              .map(
                (j) =>
                  `<div class="event-row"><time>${esc(date(j.published_at ?? j.scheduled_at ?? j.started_at ?? j.created_at))}</time><div>${badge(j.status)} <button class="job-link" data-detail-source="${"attempt_history" in j ? "queue" : "history"}" data-detail="${esc(j.id)}">${esc(j.media_filename)}</button><p>${esc(j.priority)} · ${esc(j.mode)}</p></div></div>`,
              )
              .join("")
          : empty("Nenhum registro neste intervalo.");
        wireDetails();
      } catch (e) {
        fail(e);
      }
    };
    node<HTMLButtonElement>("calendar-load").onclick = () =>
      void loadCalendar();
    await loadCalendar();
    return;
  }
  if (route === "accounts") {
    const accounts = await api<Account[]>("/accounts"),
      a = accounts[0]!;
    if (location.hash.slice(1) !== route) return;
    content.innerHTML = `<p class="subtext">Uma conta nesta fase. Detecção real exige um adapter com seletor confiável; não há confirmação simulada.</p><section class="panel"><div class="panel-heading"><h2>Conta Instagram</h2>${badge(a.status)}</div><form id="account-form" class="ops-form"><label>Username esperado<input id="account-username" required value="${esc(a.expected_username)}" placeholder="@plantaorio"></label><label>Nome de exibição<input id="account-name" required value="${esc(a.display_name)}"></label><label class="check"><input id="account-enabled" type="checkbox" ${a.enabled ? "checked" : ""}>Conta habilitada</label><button class="button">Salvar conta</button><button type="button" id="account-detect" class="button secondary">Verificar conta ativa</button></form><div class="detail-data"><div><label>Detectado</label><p>${esc(a.detected_username ?? "Não verificado")}</p></div><div><label>Última detecção</label><p>${esc(date(a.detected_at))}</p></div><div><label>Última confirmação</label><p>${esc(date(a.last_seen_at))}</p></div><div><label>Account ID</label><p>${esc(a.id)}</p></div></div><p class="info">UNKNOWN, MISMATCH, LOGGED_OUT ou UNAVAILABLE bloqueiam publicação automática. Não armazenamos senha.</p><a href="#settings">Configuração do Story desta conta →</a></section>`;
    node<HTMLFormElement>("account-form").onsubmit = (e) => {
      e.preventDefault();
      void (async () => {
        try {
          await api("/account", "PUT", {
            expected_username: node<HTMLInputElement>("account-username").value,
            display_name: node<HTMLInputElement>("account-name").value,
            enabled: node<HTMLInputElement>("account-enabled").checked,
          });
          note("Conta configurada; confirmação real permanece UNKNOWN.");
          await renderOperations(route);
        } catch (error) {
          fail(error);
        }
      })();
    };
    node<HTMLButtonElement>("account-detect").onclick = () =>
      void (async () => {
        try {
          await api("/account/detect", "POST", {});
          note("Adapter de detecção ainda não conectado; estado UNKNOWN.");
          await renderOperations(route);
        } catch (e) {
          fail(e);
        }
      })();
    return;
  }
  if (route === "system") {
    const s = await api<Summary>("");
    if (location.hash.slice(1) !== route) return;
    content.innerHTML = `<p class="subtext">Health checks locais e somente leitura. O painel continua disponível quando o emulador ou Appium estão offline.</p><section class="panel"><div class="panel-heading"><h2>Postador ${badge(s.system.status)}</h2></div><p>${esc(s.system.reason ?? "Adapter de execução não conectado.")}</p><div class="form-actions">${systemButtons()}<button class="button secondary" id="health-refresh">Verificar saúde</button></div></section><section class="panel"><h2>Health check</h2><div class="health-grid">${s.health.map((h) => `<div class="health-card"><strong>${h.component} ${badge(h.status)}</strong><p>${esc(h.message)}</p><small class="muted">${esc(date(h.checked_at))}</small></div>`).join("")}</div><p class="info">APP OK significa painel disponível. O motor de publicação não está conectado ao scheduler. INSTAGRAM UNKNOWN não autoriza execução.</p></section>`;
    wireSystem(async () => renderOperations(route));
    node<HTMLButtonElement>("health-refresh").onclick = () =>
      void (async () => {
        await api("/health");
        await renderOperations(route);
      })();
    return;
  }
}
