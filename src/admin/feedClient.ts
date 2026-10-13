import type { FeedState, FeedEntry } from "../ingestion/feedDomain.js";
type Entry = FeedEntry & {
  queue_status: string | null;
  download_status: string;
  thumbnail_available: boolean;
};
type Response = Omit<FeedState, "entries"> & {
  entries: Entry[];
  events: {
    event: string;
    timestamp: string;
    message: string;
    metadata?: unknown;
  }[];
};
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
async function api<T>(path = "", method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/feed" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Admin-Request": "local" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? "Operação RSS não concluída.");
  return data;
}
const message = (text: string, error = false) => {
  node("notice").innerHTML =
    `<div class="notice${error ? " error" : ""}">${esc(text)}</div>`;
};
export async function renderFeed() {
  const state = await api<Response>();
  if (location.hash !== "#feed") return;
  const { config } = state;
  node("content").innerHTML =
    `<section class="panel"><div class="panel-head"><h2>Entradas RSS</h2><button id="feed-check" class="button secondary">Consultar agora</button></div>
    <p class="info">Matérias existentes no primeiro feed também serão detectadas. Mídias são baixadas localmente; este módulo somente alimenta a fila. Publicação permanece desconectada.</p>
    <form id="feed-config" class="ops-form">
      <label class="check"><input id="feed-enabled" type="checkbox" ${config.enabled ? "checked" : ""}>Polling habilitado</label>
      <label>URL do feed<input id="feed-url" type="url" required value="${esc(config.url)}"></label>
      <label>Intervalo (segundos)<input id="feed-interval" type="number" min="10" max="86400" required value="${config.poll_interval_seconds}"></label>
      <label class="check"><input id="feed-auto" type="checkbox" ${config.auto_enqueue ? "checked" : ""}>Enviar automaticamente à fila</label>
      <button class="button" type="submit">Salvar RSS</button>
    </form><p>Conta: ${esc(config.account_id)} · Última consulta: ${date(state.last_checked_at)} · Conclusão: ${date(state.last_completed_at)}</p>
    ${state.last_error ? `<div class="notice error">${esc(state.last_error)}</div>` : ""}
    <p class="info">auto_enqueue=false: mídia válida fica READY até o operador enviá-la à fila. Texto do sticker vem da configuração da conta, preservado no momento da detecção. Nenhuma limpeza de mídia está ativa.</p>
    <div class="table-wrap"><table><thead><tr><th>Story / matéria</th><th>Detectado</th><th>Ingestão</th><th>Download / fila</th><th>Ações</th></tr></thead><tbody>
    ${
      state.entries
        .map(
          (
            e,
          ) => `<tr><td>${e.thumbnail_available ? `<img class="feed-thumb" src="/api/feed/entries/${encodeURIComponent(e.id)}/thumbnail" alt="Preview do Story">` : ""}
      ${e.article_url ? `<a href="${esc(e.article_url)}" target="_blank" rel="noopener noreferrer" class="feed-link">${esc(e.article_url)}</a>` : "URL da matéria ausente"}
      <small>${esc(e.feed_guid ?? e.id)}</small></td><td>${date(e.detected_at)}</td><td><span class="badge">${esc(e.status)}</span>${e.last_error ? `<p class="error-message">${esc(e.last_error)}</p>` : ""}</td>
      <td>${esc(e.download_status)}<br>Fila: ${esc(e.queue_status ?? "não inserida")}<br>${esc(e.media_type ?? "—")} · ${esc(e.downloaded_media?.mime_type ?? "—")}<br>${e.downloaded_media ? `${e.downloaded_media.file_size} bytes` : ""}</td>
      <td><div class="queue-actions"><button class="button secondary" data-feed-action="enqueue" data-id="${e.id}" ${e.status !== "READY" || e.job_id ? "disabled" : ""}>Enviar para fila</button>
      <button class="button secondary" disabled title="Motor de publicação não conectado">Publicar agora</button>
      <button class="button secondary" data-feed-action="ignore" data-id="${e.id}" ${e.job_id || ["IGNORED", "DUPLICATE", "RESOLVING", "DOWNLOADING"].includes(e.status) ? "disabled" : ""}>Ignorar</button>
      <button class="button secondary" data-feed-action="retry" data-id="${e.id}" ${e.job_id || !["ARTICLE_RESOLVE_FAILED", "MEDIA_NOT_FOUND", "MEDIA_DOWNLOAD_FAILED", "MEDIA_INVALID", "DISCOVERED", "READY", "IGNORED", "REQUIRES_REVIEW"].includes(e.status) ? "disabled" : ""}>Tentar novamente</button></div></td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="5">Nenhuma matéria detectada ainda.</td></tr>'
    }
    </tbody></table></div></section><section class="panel"><h2>Eventos de ingestão</h2>${
      [...state.events]
        .reverse()
        .slice(0, 60)
        .map(
          (e) =>
            `<div class="event-row"><time>${date(e.timestamp)}</time><div><strong>${esc(e.event)}</strong><p>${esc(e.message)}</p><pre>${esc(JSON.stringify(e.metadata ?? {}, null, 2))}</pre></div></div>`,
        )
        .join("") || "<p>Nenhum evento.</p>"
    }</section>`;
  const run = async (action: () => Promise<unknown>, text: string) => {
    document
      .querySelectorAll<HTMLButtonElement>("#content button")
      .forEach((b) => (b.disabled = true));
    try {
      await action();
      if (location.hash === "#feed") {
        await renderFeed();
        message(text);
      }
    } catch (error) {
      if (location.hash === "#feed") {
        await renderFeed();
        message(String(error), true);
      }
    }
  };
  node<HTMLFormElement>("feed-config").onsubmit = (event) => {
    event.preventDefault();
    void run(
      () =>
        api("/config", "PUT", {
          ...config,
          enabled: node<HTMLInputElement>("feed-enabled").checked,
          url: node<HTMLInputElement>("feed-url").value,
          poll_interval_seconds: Number(
            node<HTMLInputElement>("feed-interval").value,
          ),
          auto_enqueue: node<HTMLInputElement>("feed-auto").checked,
        }),
      "Configuração RSS salva.",
    );
  };
  node<HTMLButtonElement>("feed-check").onclick = () =>
    void run(async () => {
      const result = await api<{ error?: string }>("/check", "POST", {});
      if (result.error) throw Error(result.error);
    }, "Feed consultado. Publicação não executada.");
  document
    .querySelectorAll<HTMLButtonElement>("[data-feed-action]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          void run(
            () =>
              api(
                `/entries/${encodeURIComponent(button.dataset.id!)}/${button.dataset.feedAction}`,
                "POST",
                {},
              ),
            "Operação concluída. Nenhuma publicação executada.",
          )),
    );
}
