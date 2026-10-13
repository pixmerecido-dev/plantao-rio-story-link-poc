import type { UiRole } from "./editorialUi.js";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const labels: Record<string, string> = {
  DATABASE: "Banco",
  ANDROID: "Android",
  ADB: "Comunicação com Android",
  EMULATOR: "Emulador",
  APPIUM: "Conexão com Instagram",
  INSTAGRAM: "Instagram",
  OK: "Disponível",
  OFFLINE: "Indisponível",
  STARTING: "Inicializando",
  ERROR: "Precisa de atenção",
  UNKNOWN: "Não verificado",
};
interface Status {
  panel_available: boolean;
  engine_prepared: boolean;
  preparing: boolean;
  busy: boolean;
  account_confirmed: boolean;
  can_publish: false;
  test_mode: true;
  automation_paused: boolean;
  services: Record<string, { status: string; message: string }>;
  test: null | {
    id: string;
    status: string;
    message: string;
    published: false;
  };
  events: { at: string; message: string }[];
}
async function api<T>(
  path = "/api/runtime",
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Admin-Request": "local" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error ?? "Não foi possível concluir agora.");
  return v;
}
function notice(error: unknown) {
  const n = document.getElementById("notice");
  if (n)
    n.innerHTML = `<div class="notice error">${esc(error instanceof Error ? error.message : "Não foi possível concluir agora.")}</div>`;
}
let poll: ReturnType<typeof setTimeout> | undefined;
function schedule(fn: () => Promise<void>, element: string) {
  clearTimeout(poll);
  poll = setTimeout(() => {
    if (document.getElementById(element)) void fn().catch(notice);
  }, 1500);
}
export async function renderRuntimeSystem(role: UiRole) {
  const content = document.getElementById("content")!;
  content.innerHTML = `<section class="panel"><h2>Estado do sistema</h2><p>Painel disponível não significa que o motor esteja preparado.</p><div id="runtime-progress"></div><div class="form-actions"><button class="button" id="runtime-prepare">Preparar sistema</button><button class="button secondary" id="runtime-refresh">Atualizar estado</button><a class="button secondary" href="#accounts">Verificar conta</a></div><button class="button secondary" data-runtime-pause="pause">Pausar automação</button> <button class="button secondary" data-runtime-pause="resume">Retomar automação futura</button><p>Retomar não publica nesta etapa.</p><button class="button secondary" disabled>Publicar próximo — indisponível</button></section>${role === "ADMIN" ? '<section class="panel"><h2>Configurações locais</h2><form id="runtime-config"><label>Pasta do Android SDK<input id="runtime-sdk" placeholder="Detectada automaticamente"></label><label>Nome do emulador<input id="runtime-avd" list="runtime-avds" placeholder="Detectado quando existe apenas um"><datalist id="runtime-avds"></datalist></label><label>Validade da confirmação (segundos)<input type="number" id="runtime-ttl" min="30" max="3600"></label><button class="button secondary">Salvar</button></form><div class="form-actions"><button class="button secondary" data-runtime-action="restart-emulator">Reiniciar emulador</button><button class="button secondary" data-runtime-action="restart-appium">Reiniciar conexão</button><button class="button secondary" data-runtime-action="stop-appium">Encerrar conexão</button></div><button class="button secondary" id="runtime-shutdown">Encerrar aplicativo</button><details><summary>Logs técnicos e processos</summary><pre id="runtime-technical" class="safe-json"></pre></details></section>' : ""}`;
  const update = async () => {
    const s = await api<Status>();
    if (!document.getElementById("runtime-progress")) return;
    document.getElementById("runtime-progress")!.innerHTML =
      `<p><strong>Painel:</strong> ✓ Disponível</p><p><strong>Motor de Stories:</strong> ${s.engine_prepared ? "✓ Preparado" : s.preparing ? "Inicializando..." : "Não preparado"}</p>${Object.entries(
        s.services,
      )
        .map(
          ([key, v]) =>
            `<p>${v.status === "OK" ? "✓" : "⚠"} ${esc(labels[key] ?? key)} · ${esc(labels[v.status] ?? v.status)}</p>`,
        )
        .join(
          "",
        )}<p><strong>Conta:</strong> ${s.account_confirmed ? "Confirmada" : "Verificação necessária"}</p><p><strong>Controle do Instagram:</strong> ${s.busy ? "Em uso" : "Livre"}</p><p><strong>Fila:</strong> salva · Publicação automática desativada</p><p>${esc(s.events.at(-1)?.message ?? "Clique em Preparar sistema.")}</p><p>MODO TESTE ATIVO. Nenhum Story será publicado.</p>`;
    (document.getElementById("runtime-prepare") as HTMLButtonElement).disabled =
      s.busy;
    document
      .querySelectorAll<HTMLButtonElement>("[data-runtime-action]")
      .forEach((b) => (b.disabled = s.busy));
    if (role === "ADMIN") {
      const t = await api<any>("/api/runtime/technical");
      if (document.getElementById("runtime-technical"))
        document.getElementById("runtime-technical")!.textContent =
          JSON.stringify({ processes: t.processes, events: t.events }, null, 2);
    }
    schedule(update, "runtime-progress");
  };
  document.getElementById("runtime-prepare")!.onclick = () => {
    void api("/api/runtime/prepare", "POST", {}).then(update).catch(notice);
  };
  document.getElementById("runtime-refresh")!.onclick = () => {
    void api("/api/runtime/refresh", "POST", {}).then(update).catch(notice);
  };
  if (role === "ADMIN") {
    document.getElementById("runtime-shutdown")!.onclick = () => {
      if (
        confirm(
          "Encerrar o painel e os serviços iniciados por ele? Os dados serão preservados.",
        )
      )
        void api("/api/runtime/shutdown", "POST", {})
          .then(() => {
            document.getElementById("content")!.innerHTML =
              '<div class="panel">Aplicativo encerrado. Para abrir novamente, use o atalho Plantão Rio Stories.</div>';
            clearTimeout(poll);
          })
          .catch(notice);
    };
    const technical = await api<any>("/api/runtime/technical");
    for (const [id, key] of [
      ["sdk", "sdk_path"],
      ["avd", "avd"],
      ["ttl", "account_ttl_seconds"],
    ]) {
      const input = document.getElementById(
        `runtime-${id}`,
      ) as HTMLInputElement;
      if (input) input.value = String(technical.config[key!] ?? "");
    }
    void api<{ avds: string[] }>("/api/runtime/avds")
      .then((result) => {
        const list = document.getElementById("runtime-avds");
        if (list)
          list.innerHTML = result.avds
            .map((name) => `<option value="${esc(name)}"></option>`)
            .join("");
      })
      .catch(() => {});
    document.getElementById("runtime-config")!.onsubmit = (e) => {
      e.preventDefault();
      void api("/api/runtime/config", "PUT", {
        sdk_path: (document.getElementById("runtime-sdk") as HTMLInputElement)
          .value,
        avd: (document.getElementById("runtime-avd") as HTMLInputElement).value,
        account_ttl_seconds: Number(
          (document.getElementById("runtime-ttl") as HTMLInputElement).value,
        ),
        test_mode: true,
      })
        .then(update)
        .catch(notice);
    };
    document
      .querySelectorAll<HTMLButtonElement>("[data-runtime-action]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            if (
              confirm(
                "Encerrar/reiniciar este serviço? Nenhuma operação em andamento será interrompida.",
              )
            )
              void api("/api/runtime/control", "POST", {
                action: b.dataset.runtimeAction,
              })
                .then(update)
                .catch(notice);
          }),
      );
  }
  document.querySelectorAll<HTMLButtonElement>("[data-runtime-pause]").forEach(
    (b) =>
      (b.onclick = () => {
        void api("/api/runtime/control", "POST", {
          action: b.dataset.runtimePause,
        })
          .then(update)
          .catch(notice);
      }),
  );
  await update();
}
export async function mountRuntimeTest() {
  const widget = document.getElementById("runtime-test-widget");
  if (!widget) return;
  widget.innerHTML =
    '<h3>Teste seguro no Instagram</h3><p>Salve a configuração primeiro. Usaremos a arte de exemplo e o link https://plantaorio.com.br/. O teste termina no editor sem publicar. Confira o estilo visualmente.</p><p id="runtime-test-status"></p><button id="runtime-test-start" class="button">Testar no Instagram</button> <button id="runtime-test-end" class="button secondary">Encerrar teste</button><p><a href="#system">Preparar sistema</a> · <a href="#accounts">Verificar conta</a></p>';
  const update = async () => {
    const s = await api<Status>();
    if (!document.getElementById("runtime-test-widget")) return;
    document.getElementById("runtime-test-status")!.textContent =
      s.test?.message ??
      (s.engine_prepared
        ? "Sistema preparado. Confirme a conta antes do teste."
        : "Prepare o sistema antes do teste.");
    (
      document.getElementById("runtime-test-start") as HTMLButtonElement
    ).disabled =
      s.busy ||
      !s.engine_prepared ||
      !s.account_confirmed ||
      s.test?.status === "TEST_READY";
    (
      document.getElementById("runtime-test-end") as HTMLButtonElement
    ).disabled = s.busy || !s.engine_prepared;
    schedule(update, "runtime-test-widget");
  };
  for (const [id, path] of [
    ["start", "/api/runtime/test"],
    ["end", "/api/runtime/test/end"],
  ])
    document.getElementById(`runtime-test-${id}`)!.onclick = () => {
      void api(path, "POST", {}).then(update).catch(notice);
    };
  await update();
}
