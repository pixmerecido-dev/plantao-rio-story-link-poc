import {panelObservedLimit,minimumScale,clampScale,MINIMUM_SIZE_MESSAGE,type ObservedStickerLimit} from "./stickerSizeLimit.js";
let observedSizeLimits:ObservedStickerLimit[]=[];
import { renderRuntimeSystem, mountRuntimeTest } from './runtimeClient.js';
import { UI_ROUTES, canViewRoute, type UiRole } from "./editorialUi.js";
import { renderEditorialRoute } from "./editorialClient.js";
import { renderFeed } from "./feedClient.js";
import {
  estimateStickerPreview,
  PREVIEW_STYLE_LABELS,
  dashboardStickerPreview,
  applyStickerPreview,
  refreshDashboardPreview,
} from "./stickerPreview.js";
import {
  renderOperations,
  operationBanner,
  queueOverview,
  operationalLogs,
} from "./operationsClient.js";
import { REFERENCE } from "./domain.js";
import type {
  StorySettings,
  PublicationJob,
  PublicationEvent,
} from "./domain.js";
import type { publicationStats } from "./publicationsService.js";
type Stats = ReturnType<typeof publicationStats>;
const element = <T extends HTMLElement = HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento ${id} ausente.`);
  return node as T;
};
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const duration = (value: number | null) =>
  value === null
    ? "—"
    : value < 1000
      ? `${value} ms`
      : `${(value / 1000).toFixed(1)} s`;
const labels: Record<string, string> = {
  QUEUED: "Na fila",
  PREPARING: "Preparando",
  READY: "Pronto",
  PUBLISHING: "Publicando",
  SUCCESS: "Sucesso",
  FAILED: "Falha",
  INCONCLUSIVE: "Inconclusivo",
  CANCELLED: "Cancelado",
  SCHEDULED: "Agendado",
  PAUSED: "Pausado",
  DUPLICATE: "Duplicado",
  REQUIRES_REVIEW: "Revisão necessária",
};
const badge = (status: string) =>
  `<span class="badge ${escape(status)}">${escape(labels[status] ?? status)}</span>`;
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Admin-Request": "local" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Operação não concluída.");
  return value as T;
}
function notice(message: string, error = false) {
  element("notice").innerHTML = message
    ? `<div class="notice ${error ? "error" : ""}">${escape(message)}</div>`
    : "";
}
const empty = (title: string, message: string) =>
  `<div class="empty"><strong>${escape(title)}</strong>${escape(message)}</div>`;
function jobsTable(jobs: PublicationJob[]) {
  if (!jobs.length)
    return empty(
      "Nenhuma publicação registrada",
      "Os resumos locais do motor aparecerão aqui quando estiverem disponíveis.",
    );
  return `<div class="table-wrap"><table><thead><tr><th>Data/Hora</th><th>Mídia</th><th>Link</th><th>Texto do Sticker</th><th>Instagram</th><th>Facebook</th><th>Status</th><th>Duração</th></tr></thead><tbody>${jobs.map((job) => `<tr class="clickable" tabindex="0" data-job="${escape(job.id)}" aria-label="Detalhes da publicação ${escape(job.job_id)}"><td>${escape(date(job.published_at ?? job.started_at ?? job.created_at))}</td><td><span class="badge">${job.media_type === "VIDEO" ? "VÍDEO" : job.media_type === "IMAGE" ? "IMAGEM" : "OUTRO"}</span></td><td><span class="truncate" title="${escape(job.story_url)}">${escape(job.story_url)}</span></td><td><span class="truncate">${escape(job.sticker_text)}</span></td><td>${badge(job.instagram_status)}</td><td>${job.facebook_crosspost === true ? "Ativado" : job.facebook_crosspost === false ? "Desativado" : "Não confirmado"}</td><td>${badge(job.status)}</td><td>${escape(duration(job.duration_ms))}</td></tr>`).join("")}</tbody></table></div>`;
}
function wireJobs() {
  document.querySelectorAll<HTMLElement>("[data-job]").forEach((node) => {
    const open = () =>
      void showDetail(node.dataset.job!).catch((error) =>
        notice(error.message, true),
      );
    node.onclick = open;
    node.onkeydown = (event) => {
      if (event.key === "Enter") open();
    };
  });
}
function eventRows(events: PublicationEvent[]) {
  return events.length
    ? events
        .map(
          (event) =>
            `<div class="event-row"><time>${escape(date(event.timestamp))}</time><div><strong>${escape(event.event)}</strong><p>${escape(event.message)}</p><small class="muted">Job: ${escape(event.job_id)}</small>${event.metadata ? `<details class="admin-only"><summary class="muted">Metadados</summary><pre>${escape(JSON.stringify(event.metadata, null, 2))}</pre></details>` : ""}</div></div>`,
        )
        .join("")
    : empty(
        "Nenhum evento registrado",
        "Eventos ficam associados ao job. Importações não inventam etapas anteriores.",
      );
}
async function showDetail(id: string) {
  const { job, events } = await api<{
    job: PublicationJob;
    events: PublicationEvent[];
  }>(`/api/publications/${encodeURIComponent(id)}`);
  const fields: [string, unknown][] = [
    ["Job ID", job.job_id],
    [
      "Conta",
      job.instagram_username ?? job.account_id ?? "Legado não verificado",
    ],
    ["Prioridade", job.priority ?? "—"],
    ["Modo", job.mode ?? "—"],
    ["Criado", date(job.created_at)],
    ["Iniciado", date(job.started_at)],
    ["Finalizado", date(job.finished_at)],
    ["Publicado", date(job.published_at)],
    ["Duração", duration(job.duration_ms)],
    ["Mídia", job.media_filename ?? "—"],
    ["Tipo", job.media_type],
    ["Tentativas", job.attempts],
    [
      "Escala",
      job.sticker_scale === null
        ? "—"
        : `${(job.sticker_scale * 100).toFixed(1)}%`,
    ],
    ["Centro X (diagnóstico)", job.sticker_x ?? "—"],
    ["Centro Y (diagnóstico)", job.sticker_y ?? "—"],
    [
      "Facebook",
      job.facebook_crosspost === true
        ? "Compartilhamento ativado"
        : job.facebook_crosspost === false
          ? "Desativado"
          : "Não confirmado",
    ],
  ];
  element("detail-content").innerHTML =
    `<div class="detail-head"><div><h2>Detalhes da publicação</h2>${badge(job.status)}</div><button class="button secondary" id="close-detail" aria-label="Fechar detalhes">✕</button></div><div class="detail-grid"><div>${job.media_type === "IMAGE" && job.media_filename ? `<img class="detail-image" id="job-thumbnail" src="/api/publications/${encodeURIComponent(job.id)}/media" alt="Mídia da publicação">` : empty("Miniatura indisponível", "A mídia original pode não estar acessível.")}</div><div><div class="detail-data">${fields.map(([label, value]) => `<div><label>${escape(label)}</label><p>${escape(value)}</p></div>`).join("")}</div><div class="field"><label>URL da matéria</label><a href="${escape(job.story_url)}" target="_blank" rel="noopener noreferrer">${escape(job.story_url)}</a></div><div class="field"><label>Texto do Sticker</label><p>${escape(job.sticker_text)}</p></div>${job.error_message ? `<div class="error-message">${escape(job.error_code ?? "Erro")}<br>${escape(job.error_message)}</div>` : ""}${job.effective_settings ? `<details><summary>Configuração congelada</summary><pre class="safe-json">${escape(JSON.stringify(job.effective_settings, null, 2))}</pre></details>` : ""}${job.source_note ? `<p class="info">${escape(job.source_note)}</p>` : ""}</div></div><h3 style="margin-top:26px">Logs relacionados</h3>${eventRows(events)}`;
  element<HTMLButtonElement>("close-detail").onclick = () =>
    element<HTMLDialogElement>("detail").close();
  const thumbnail = document.getElementById(
    "job-thumbnail",
  ) as HTMLImageElement | null;
  if (thumbnail)
    thumbnail.onerror = () => {
      thumbnail.replaceWith(
        Object.assign(document.createElement("p"), {
          textContent: "Mídia original indisponível.",
          className: "muted",
        }),
      );
    };
  element<HTMLDialogElement>("detail").showModal();
}
let savingSettings = false;
let model: StorySettings | undefined,
  viewVersion = 0;
let pubPage = 1,
  filters = { status: "", type: "", q: "" };
const route = () => location.hash.slice(1) || "dashboard";
async function load() {
  const version = ++viewVersion,
    current = route();
  const titles = Object.fromEntries(
    Object.entries(UI_ROUTES).map(([key, value]) => [key, value.title]),
  );
  let role: UiRole =
    localStorage.getItem("postador-ui-role") === "ADMIN" ? "ADMIN" : "OPERATOR";
  document.body.dataset.uiRole = role;
  element<HTMLSelectElement>("ui-role").value = role;
  if (!canViewRoute(role, current)) {
    location.hash = "dashboard";
    return;
  }
  if (!titles[current]) {
    location.hash = "dashboard";
    return;
  }
  element("page-title").textContent = titles[current]!;
  document
    .querySelectorAll<HTMLElement>("[data-route]")
    .forEach((node) =>
      node.classList.toggle("active", node.dataset.route === current),
    );
  try {
    if (
      [
        "dashboard",
        "feed",
        "queue",
        "automation",
        "accounts",
        "publications",
        "alerts",
        "configuration",
      ].includes(current)
    ) {
      await renderEditorialRoute(current, role);
      return;
    }
    if (current === "queue-tools" || current === "agenda-tools") {
      await renderOperations(
        current === "queue-tools" ? "queue" : "automation",
      );
      return;
    }
    if (current === "system") { await renderRuntimeSystem(role); return; }
    if (["queue", "automation", "accounts"].includes(current)) {
      await renderOperations(current);
      return;
    }
    if (current === "dashboard") {
      const data = await api<{
        stats: Stats;
        recent: PublicationJob[];
        imported: { warnings: string[] };
      }>("/api/dashboard");
      if (version !== viewVersion) return;
      const [operational, savedStory, queueView, sizeLimits] = await Promise.all([
        operationBanner(),
        api<StorySettings>("/api/settings"),
        queueOverview(),
        api<ObservedStickerLimit[]>("/api/sticker-size-limits"),
      ]);
      observedSizeLimits=sizeLimits;
      if (version !== viewVersion) return;
      const s = data.stats,
        cards: [string, string, string][] = [
          ["Publicações hoje", String(s.today), "Confirmadas no dia"],
          ["Últimas 24 horas", String(s.last24h), "Janela móvel"],
          ["Últimos 7 dias", String(s.last7d), "Publicações confirmadas"],
          ["Últimos 30 dias", String(s.last30d), "Publicações confirmadas"],
          ["Publicações com sucesso", String(s.success), "Todos os registros"],
          ["Falhas", String(s.failed), "Todos os registros"],
          [
            "Taxa de sucesso",
            s.successRate === null ? "—" : `${s.successRate.toFixed(1)}%`,
            "Sucesso / tentativas concluídas",
          ],
          [
            "Última publicação",
            date(s.lastPublication),
            "Última confirmação registrada",
          ],
          [
            "Horário médio das publicações",
            s.averageTime ?? "—",
            "Somente horários de publicação conhecidos",
          ],
          [
            "Faixa com mais publicações",
            s.peakHours ?? "—",
            "Somente horários reais confirmados",
          ],
          ["Fila atual", String(operational.queueCount), "Jobs pendentes"],
          [
            "Próxima postagem",
            operational.nextTime,
            "Agendamento, não promessa de publicação",
          ],
        ];
      element("content").innerHTML =
        `${operational.html}${queueView.html}<p class="subtext">Acompanhe os resultados do postador. Horários de Brasília.</p><div class="stats-grid">${cards.map(([label, value, note]) => `<div class="stat-card"><div class="label">${escape(label)}<span>↗</span></div><strong class="${value.length > 9 ? "date" : ""}">${escape(value)}</strong><small>${escape(note)}</small></div>`).join("")}</div><div class="dashboard-bottom"><section class="panel"><div class="panel-heading"><div><h2>Últimas publicações</h2><span class="muted">Registros reais dos resumos locais do motor</span></div><a href="#publications">Ver histórico →</a></div>${jobsTable(data.recent)}</section>${dashboardStickerPreview(savedStory,observedSizeLimits)}</div><p class="muted">${s.inconclusive} resultado(s) inconclusivo(s). Na ausência de horário exato de publicação, as contagens usam o término registrado. ${data.imported.warnings.length ? `${data.imported.warnings.length} resumo(s) não puderam ser importados.` : ""}</p>`;
      wireJobs();
      refreshDashboardPreview(savedStory,observedSizeLimits);
      operational.wire();
      queueView.wire();
    } else if (current === "publications") {
      const query = new URLSearchParams({ ...filters, page: String(pubPage) });
      const data = await api<{
        items: PublicationJob[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/api/publications?${query}`);
      if (version !== viewVersion) return;
      element("content").innerHTML =
        `<section class="panel"><div class="panel-heading"><div><h2>Histórico de publicações</h2><span class="muted">Abra um registro para ver mídia, resultado e logs.</span></div></div><div class="filters"><input id="filter-q" type="text" placeholder="Buscar por link, texto, mídia ou job" aria-label="Buscar publicação" value="${escape(filters.q)}"><select id="filter-status" aria-label="Filtrar por status"><option value="">Todos os status</option>${Object.entries(
          labels,
        )
          .map(
            ([key, value]) =>
              `<option value="${key}" ${filters.status === key ? "selected" : ""}>${value}</option>`,
          )
          .join(
            "",
          )}</select><select id="filter-type" aria-label="Filtrar por mídia"><option value="">Todas as mídias</option><option value="IMAGE" ${filters.type === "IMAGE" ? "selected" : ""}>Imagem</option><option value="VIDEO" ${filters.type === "VIDEO" ? "selected" : ""}>Vídeo</option></select><button id="filter-apply" class="button secondary">Filtrar</button></div>${jobsTable(data.items)}<div class="pagination"><span>${data.total} registro(s) · Página ${data.page}</span><div><button id="prev" class="button ghost" ${data.page <= 1 ? "disabled" : ""}>← Anterior</button> <button id="next" class="button ghost" ${data.page * data.pageSize >= data.total ? "disabled" : ""}>Próxima →</button></div></div></section>`;
      element<HTMLButtonElement>("filter-apply").onclick = () => {
        filters = {
          q: element<HTMLInputElement>("filter-q").value,
          status: element<HTMLSelectElement>("filter-status").value,
          type: element<HTMLSelectElement>("filter-type").value,
        };
        pubPage = 1;
        void load();
      };
      element<HTMLInputElement>("filter-q").onkeydown = (event) => {
        if (event.key === "Enter")
          element<HTMLButtonElement>("filter-apply").click();
      };
      element<HTMLButtonElement>("prev").onclick = () => {
        pubPage--;
        void load();
      };
      element<HTMLButtonElement>("next").onclick = () => {
        pubPage++;
        void load();
      };
      wireJobs();
    } else if (current === "logs") {
      const events = await api<PublicationEvent[]>("/api/events");
      if (version !== viewVersion) return;
      element("content").innerHTML =
        `<section class="panel"><div class="panel-heading"><div><h2>Eventos do postador</h2><span class="muted">Últimos 200 eventos · agrupamento por job nos detalhes da publicação</span></div></div>${eventRows(events)}</section>${await operationalLogs()}`;
    } else {
      if (!model) model = await api<StorySettings>("/api/settings");
      if (version !== viewVersion) return;
      observedSizeLimits=await api<ObservedStickerLimit[]>("/api/sticker-size-limits");
      renderSettings();
    }
  } catch (error) {
    if (version !== viewVersion) return;
    notice(
      error instanceof Error ? error.message : "Não foi possível carregar.",
      true,
    );
    element("content").innerHTML = empty(
      "Não foi possível carregar",
      "Tente atualizar. Se continuar, peça ajuda ao administrador.",
    );
  }
}
function renderSettings() {
  if (!model) return;
  const s = model.story.sticker;
  const presets = s.presets;
  element("content").innerHTML =
    `<div class="settings-grid"><section class="panel"><h2>Aparência padrão do Story</h2><p class="muted">Ajuste o padrão e acompanhe a simulação ao lado.</p><div class="field"><label for="sticker-text">Texto do link</label><input id="sticker-text" type="text" value="${escape(s.text)}"><p class="muted" id="text-counter"></p><p class="muted" id="text-warning" role="status"></p><div class="presets">${presets.map((p) => `<button class="preset" data-preset="${escape(p.name)}" title="${escape(p.text)}">${escape(p.text)}</button>`).join("")}</div></div><div class="field"><label for="sticker-style">Estilo do link</label><select id="sticker-style">${PREVIEW_STYLE_LABELS.map((name, index) => `<option value="${index}" ${s.style_index === index ? "selected" : ""}>${name}</option>`).join("")}</select><p class="muted">Escolha como o link deve aparecer.</p></div><div class="field admin-only"><label for="sticker-max-text">Máximo de caracteres</label><input id="sticker-max-text" placeholder="Automático" type="number" min="1" step="1" value="${s.max_text_length ?? ""}"><p class="muted">Deixe vazio para usar o padrão automático.</p></div><div class="field"><div class="field-row"><label for="sticker-x">Posição horizontal</label><output id="x-value"></output></div><input id="sticker-x" type="range" min="0" max="100" step="any" value="${s.x_pct * 100}"><div class="range-labels"><span>Esquerda</span><span>Direita</span></div></div><div class="field"><div class="field-row"><label for="sticker-y">Posição vertical</label><output id="y-value"></output></div><input id="sticker-y" type="range" min="0" max="100" step="any" value="${s.y_pct * 100}"><div class="range-labels"><span>Cima</span><span>Baixo</span></div></div><div class="field"><div class="field-row"><label for="sticker-scale">Tamanho do link</label><output id="scale-value"></output></div><p class="muted">Altera proporcionalmente texto, ícone e fundo.</p><input id="sticker-scale" type="range" min="${s.min_scale * 100}" max="${s.max_scale * 100}" step="0.1" value="${s.scale * 100}"><p class="muted" id="minimum-size-warning" role="status"></p><div class="range-labels"><span>Menor</span><span>Maior</span></div><div class="fine-buttons"><button data-size="-1">− Diminuir</button><button data-size="1">+ Aumentar</button><button id="reset-size">Restaurar tamanho</button></div><details class="admin-only"><summary class="muted" style="margin-top:16px">Limites de escala</summary><div class="limits"><label>Mínimo (%)<input id="scale-min" type="number" min="25" max="125" value="${s.min_scale * 100}"></label><label>Máximo (%)<input id="scale-max" type="number" min="25" max="125" value="${s.max_scale * 100}"></label></div></details></div><label class="check admin-only"><input id="sticker-enabled" type="checkbox" ${s.enabled ? "checked" : ""}>Mostrar link na prévia</label><div class="field admin-only"><h3>Destinos padrão</h3><label class="check"><input id="instagram-enabled" type="checkbox" ${model.publishing.instagram_enabled ? "checked" : ""}>Instagram</label><label class="check"><input id="facebook-enabled" type="checkbox" ${model.publishing.facebook_enabled ? "checked" : ""}>Facebook Story</label><p class="muted">Preferências para integração futura; não autorizam publicação.</p></div><div class="info">O envio só será permitido quando todas as verificações estiverem concluídas.</div><div class="form-actions"><button id="save-settings" class="button">Salvar configuração</button><button id="reset-settings" class="button secondary">Restaurar padrão</button></div><div class="info">Salve o padrão para os próximos Stories. O envio pelo painel ainda está desativado.</div><div id="runtime-test-widget"></div></section><section class="panel preview-panel"><div class="preview-top"><div><h2>Prévia do Story</h2><span class="muted">Aparência aproximada</span></div><span class="preview-pill">STORY</span></div><div class="preview-shell"><div class="story-preview" id="preview"><div class="preview-placeholder">Imagem de exemplo indisponível</div><img id="preview-image" src="/api/preview" alt="Arte de exemplo do Story"><div class="preview-sticker" id="preview-sticker"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14l4-4m-6 7l-1 1a4 4 0 01-6-6l5-5a4 4 0 015.5-.2M16 7l1-1a4 4 0 016 6l-5 5a4 4 0 01-5.5.2" fill="none" stroke="currentColor" stroke-width="2"/></svg><span id="preview-text"></span></div></div></div><details class="admin-only"><summary>Informações técnicas</summary><p class="diagnostic" id="preview-diagnostic"></p></details></section></div>`;
  void mountRuntimeTest();
  element<HTMLImageElement>("preview-image").onerror = () =>
    (element("preview-image").hidden = true);
  const sync = () => {
    if (!model) return;
    const sticker = model.story.sticker;
    sticker.text = element<HTMLInputElement>("sticker-text").value;
    sticker.style_index = Number(
      element<HTMLSelectElement>("sticker-style").value,
    ) as 0 | 1 | 2 | 3;
    const limit = element<HTMLInputElement>("sticker-max-text").value;
    sticker.max_text_length = limit === "" ? null : Number(limit);
    sticker.x_pct = Number(element<HTMLInputElement>("sticker-x").value) / 100;
    sticker.y_pct = Number(element<HTMLInputElement>("sticker-y").value) / 100;
    const min = Number(element<HTMLInputElement>("scale-min").value) / 100,
      max = Number(element<HTMLInputElement>("scale-max").value) / 100;
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      element<HTMLInputElement>("sticker-scale").min = String(min * 100);
      element<HTMLInputElement>("sticker-scale").max = String(max * 100);
    }
    sticker.min_scale = min;
    sticker.max_scale = max;
    sticker.scale =
      Number(element<HTMLInputElement>("sticker-scale").value) / 100;
    sticker.enabled = element<HTMLInputElement>("sticker-enabled").checked;
    model.publishing.instagram_enabled =
      element<HTMLInputElement>("instagram-enabled").checked;
    model.publishing.facebook_enabled =
      element<HTMLInputElement>("facebook-enabled").checked;
    updatePreview();
  };
  [
    "sticker-text",
    "sticker-style",
    "sticker-max-text",
    "sticker-x",
    "sticker-y",
    "sticker-scale",
    "scale-min",
    "scale-max",
    "sticker-enabled",
    "instagram-enabled",
    "facebook-enabled",
  ].forEach((id) => (element(id).oninput = sync));
  document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach(
    (button) =>
      (button.onclick = () => {
        const preset = s.presets.find((p) => p.name === button.dataset.preset);
        if (!preset) return;
        element<HTMLInputElement>("sticker-text").value = preset.text;
        element<HTMLSelectElement>("sticker-style").value = String(
          preset.style_index,
        );
        if (preset.scale !== undefined)
          element<HTMLInputElement>("sticker-scale").value = String(
            preset.scale * 100,
          );
        sync();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-nudge]").forEach(
    (button) =>
      (button.onclick = () => {
        const [axis, delta] = button.dataset.nudge!.split(":");
        const input = element<HTMLInputElement>(
          axis === "x" ? "sticker-x" : "sticker-y",
        );
        input.value = String(
          Math.max(
            0,
            Math.min(
              100,
              Number(input.value) +
                (Number(delta) /
                  (axis === "x" ? REFERENCE.width : REFERENCE.height)) *
                  100,
            ),
          ),
        );
        sync();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-size]").forEach(
    (button) =>
      (button.onclick = () => {
        const input = element<HTMLInputElement>("sticker-scale");
        input.value = String(Number(input.value) + Number(button.dataset.size));
        sync();
      }),
  );
  element<HTMLButtonElement>("reset-size").onclick = () => {
    element<HTMLInputElement>("sticker-scale").value = String(
      (REFERENCE.stickerWidth / REFERENCE.stickerWidthBefore) * 100,
    );
    sync();
  };
  element<HTMLButtonElement>("save-settings").onclick = async () => {
    const button = element<HTMLButtonElement>("save-settings");
    savingSettings = true;
    button.disabled = true;
    try {
      sync();
      model = await api<StorySettings>("/api/settings", "PUT", model);
      notice("Configuração salva. O motor do Instagram permanece inalterado.");
      if (route() === "settings") renderSettings();
    } catch (error) {
      notice(error instanceof Error ? error.message : "Falha ao salvar.", true);
    } finally {
      savingSettings = false;
      button.disabled = false;
      updatePreview();
    }
  };
  element<HTMLButtonElement>("reset-settings").onclick = async () => {
    try {
      model = await api<StorySettings>("/api/settings/reset", "POST", {});
      notice("Padrão restaurado e salvo.");
      if (route() === "settings") renderSettings();
    } catch (error) {
      notice(
        error instanceof Error ? error.message : "Falha ao restaurar.",
        true,
      );
    }
  };
  updatePreview();
  void document.fonts.ready.then(updatePreview);
}
function updatePreview() {
  if (!model || route() !== "settings") return;
  const s = model.story.sticker;
  const limit=panelObservedLimit(observedSizeLimits,s.text,s.style_index);
  const floor=Math.max(s.min_scale,limit?minimumScale(limit):s.min_scale);
  const requestedScale=s.scale;
  s.scale=Math.max(floor,s.scale);s.max_scale=Math.max(s.max_scale,floor);
  const range=element<HTMLInputElement>("sticker-scale");
  range.min=String(floor*100);range.max=String(Math.max(s.max_scale,floor)*100);range.value=String(s.scale*100);
  element("minimum-size-warning").textContent=limit && (requestedScale<floor || s.scale<=floor+0.001) ? MINIMUM_SIZE_MESSAGE : "";
  element("x-value").textContent = `${(s.x_pct * 100).toFixed(1)}%`;
  element("y-value").textContent = `${(s.y_pct * 100).toFixed(1)}%`;
  element("scale-value").textContent = `${(s.scale * 100).toFixed(1)}%`;
  const sticker = element("preview-sticker");
  sticker.hidden = !s.enabled;
  sticker.style.display = s.enabled ? "flex" : "none";
  sticker.style.left = `${s.x_pct * 100}%`;
  sticker.style.top = `${s.y_pct * 100}%`;
  const estimated = estimateStickerPreview(s.text, s.scale,limit);
  sticker.dataset.style = String(s.style_index);
  applyStickerPreview(sticker, s.text, s.scale, element("preview").clientWidth,limit);
  element("preview-text").title = s.text;
  element("text-counter").textContent =
    `${estimated.text_length} caracteres${s.max_text_length === null ? "" : ` / ${s.max_text_length}`}`;
  const exceeds =
    s.max_text_length !== null && estimated.text_length > s.max_text_length;
  element("text-warning").textContent = exceeds
    ? "Texto muito longo para o sticker."
    : estimated.capped
      ? "Texto longo: confira a aparência antes de publicar."
      : "";
  element<HTMLButtonElement>("save-settings").disabled =
    exceeds || savingSettings;
  element("preview-diagnostic").textContent =
    `Centro calculado: ${(s.x_pct * REFERENCE.width).toFixed(1)}, ${(s.y_pct * REFERENCE.height).toFixed(1)} px · Escala ${(s.scale * 100).toFixed(1)}%`;
}
element<HTMLSelectElement>("ui-role").onchange = () => {
  localStorage.setItem(
    "postador-ui-role",
    element<HTMLSelectElement>("ui-role").value,
  );
  notice("");
  void load();
};
element<HTMLButtonElement>("refresh").onclick = () => {
  notice("");
  void load();
};
window.addEventListener("hashchange", () => {
  notice("");
  void load();
});
window.addEventListener("resize", updatePreview);
void document.fonts.ready.then(updatePreview);
void load();
