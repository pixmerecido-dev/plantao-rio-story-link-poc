/** Presentation permissions, not authentication. Server authorization will use this contract later. */
export type UiRole = "OPERATOR" | "ADMIN";
export class EditorialRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
export function accountVerificationFailureMessage(error: unknown): string {
  return error instanceof EditorialRequestError && [400, 409].includes(error.status)
    ? error.message
    : "Não foi possível verificar a conta agora. Consulte o Diagnóstico.";
}
export const UI_STATUS_LABELS: Record<string, string> = {
  READY: "Pronto",
  QUEUED: "Na fila",
  SCHEDULED: "Agendado",
  PREPARING: "Preparando",
  PUBLISHING: "Publicando",
  SUCCESS: "Publicado",
  FAILED: "Erro",
  PAUSED: "Pausado",
  CANCELLED: "Cancelado",
  INCONCLUSIVE: "Precisa de conferência",
  REQUIRES_REVIEW: "Precisa de revisão",
  DUPLICATE: "Já recebida",
  DISCOVERED: "Recebida",
  RESOLVING: "Preparando imagem",
  DOWNLOADING: "Baixando imagem",
  IGNORED: "Ignorada",
  ARTICLE_RESOLVE_FAILED: "Não foi possível abrir a matéria",
  MEDIA_NOT_FOUND: "Imagem não encontrada",
  MEDIA_DOWNLOAD_FAILED: "Não foi possível baixar a imagem",
  MEDIA_INVALID: "Imagem precisa de revisão",
  ONLINE: "Disponível",
  OFFLINE: "Indisponível",
  ERROR: "Precisa de atenção",
  UNKNOWN: "Não confirmada",
  OK: "Confirmada",
  MISMATCH: "Conta diferente",
  LOGGED_OUT: "Entre no Instagram",
  UNAVAILABLE: "Erro na verificação",
  DEGRADED: "Precisa de atenção",
};
export const UI_ROUTES = {
  dashboard: { title: "Visão geral", category: "editorial" },
  feed: { title: "Novas matérias", category: "editorial" },
  queue: { title: "Fila de Stories", category: "editorial" },
  automation: { title: "Agenda", category: "editorial" },
  accounts: { title: "Contas", category: "editorial" },
  publications: { title: "Publicados", category: "editorial" },
  settings: { title: "Configuração do Story", category: "editorial" },
  alerts: { title: "Alertas", category: "editorial" },
  configuration: { title: "Configurações", category: "administrative" },
  system: { title: "Diagnóstico", category: "editorial" },
  logs: { title: "Logs técnicos", category: "technical" },
  "queue-tools": { title: "Teste de fila", category: "technical" },
  "agenda-tools": { title: "Políticas avançadas", category: "administrative" },
} as const;
export function canViewRoute(role: UiRole, route: string, editStory = true) {
  const item = UI_ROUTES[route as keyof typeof UI_ROUTES];
  return (
    !!item &&
    (role === "ADMIN" ||
      (item.category === "editorial" && (route !== "settings" || editStory)))
  );
}
export function articleLabel(url: string, title?: string | null) {
  if (title?.trim()) return title;
  try {
    const slug = decodeURIComponent(
      new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "Matéria",
    );
    const text = slug.replace(/-[a-z0-9]{6,8}$/i, "").replace(/[-_]/g, " ");
    return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
  } catch {
    return "Abrir matéria";
  }
}
