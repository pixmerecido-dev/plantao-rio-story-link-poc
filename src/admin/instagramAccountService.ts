import type { OperationsRepository } from "./operationsStorage.js";
import { ValidationError } from "./domain.js";
import { audit, nowISO, logEvent } from "./operationAudit.js";
export const normalizeInstagramHandle = (value: string) =>
  value.trim().replace(/^@/, "").toLowerCase();
export class InstagramAccountService {
  constructor(
    private store: OperationsRepository,
    private detector?: (usernameResourceId?: string) => Promise<{
      username: string | null;
      status: "OK" | "LOGGED_OUT" | "UNAVAILABLE" | "UNKNOWN";
      evidence?: {
        profile_selected: boolean;
        username_resource_id: string;
        captured_at: string;
      };
      candidates?: import("../instagram/accountVerification.js").AccountCandidate[];
      message?: string;
    }>,
  ) {}
  async getExpectedAccount(id: string) {
    return (await this.store.read()).instagram_accounts.find(
      (a) => a.id === id,
    );
  }
  async configure(
    id: string,
    input: {
      expected_username: string;
      display_name: string;
      enabled: boolean;
    },
  ) {
    if (
      typeof input.expected_username !== "string" ||
      !/^@?[A-Za-z0-9._]{1,30}$/.test(input.expected_username) ||
      typeof input.display_name !== "string" ||
      input.display_name.length > 80 ||
      typeof input.enabled !== "boolean"
    )
      throw new ValidationError("Conta inválida.");
    return this.store.transact((s) => {
      const a = s.instagram_accounts.find((a) => a.id === id);
      if (!a) throw new ValidationError("Conta não encontrada.");
      const before = structuredClone(a);
      a.expected_username = input.expected_username.replace(/^@/, "");
      a.username = a.expected_username;
      a.display_name = input.display_name;
      a.enabled = input.enabled;
      a.status = "UNKNOWN";
      a.detected_username = null;
      a.detected_at = null;
      a.last_seen_at = null;
      a.account_expected = a.expected_username;
      a.account_detected = null;
      a.account_match = false;
      a.account_verified_at = null;
      a.verification_evidence = null;
      audit(s, `account.${id}`, before, a);
      return a;
    });
  }
  async detectCurrentAccount(id: string) {
    const before = await this.getExpectedAccount(id);
    const detection = this.detector
      ? await this.detector(before?.username_resource_id)
      : null;
    return this.store.transact((s) => {
      const a = s.instagram_accounts.find((a) => a.id === id);
      if (!a) throw new ValidationError("Conta não encontrada.");
      a.detected_at = nowISO();
      a.detected_username = detection?.username ?? null;
      a.status = !detection
        ? "UNKNOWN"
        : detection.status !== "OK"
          ? detection.status
          : normalizeInstagramHandle(detection.username ?? "") ===
                normalizeInstagramHandle(a.expected_username) &&
              !!a.expected_username
            ? "OK"
            : "MISMATCH";
      if (a.status === "OK") a.last_seen_at = nowISO();
      a.account_expected = a.expected_username;
      a.account_detected = a.detected_username;
      a.account_verified_at = detection?.evidence?.captured_at ?? null;
      a.account_match = a.status === "OK";
      a.verification_evidence = detection?.evidence ?? null;
      if (detection?.evidence)
        a.username_resource_id ??= detection.evidence.username_resource_id;
      a.verification_candidates = detection?.candidates ?? [];
      a.verification_message = detection?.message ?? "";
      logEvent(s, id, "ACCOUNT_CHECKED", "Verificação da conta concluída.", {
        account_expected: a.account_expected,
        account_detected: a.account_detected,
        account_match: a.account_match,
        account_verified_at: a.account_verified_at,
        status: a.status,
      });
      return a;
    });
  }
  async chooseUsernameField(id: string, resourceId: string) {
    return this.store.transact((s) => {
      const a = s.instagram_accounts.find((a) => a.id === id);
      if (
        !a ||
        typeof resourceId !== "string" ||
        !a.verification_candidates?.some((c) => c.resource_id === resourceId)
      )
        throw new ValidationError(
          "Escolha um nome observado no próprio perfil.",
        );
      audit(
        s,
        `account.${id}.username_resource_id`,
        a.username_resource_id ?? null,
        resourceId,
      );
      a.username_resource_id = resourceId;
      a.status = "UNKNOWN";
      a.account_match = false;
      a.verification_evidence = null;
      a.account_verified_at = null;
      return a;
    });
  }
  /** Publication adapters must call this with a live detector immediately before each job; cached labels are not consent. */
  async requireFreshAccountForPublication(id: string) {
    await this.detectCurrentAccount(id);
    const result = await this.validateActiveAccount(id);
    if (!result.match)
      throw new ValidationError(
        result.detected
          ? `Outra conta do Instagram está conectada. Esperado: @${result.expected ?? "não cadastrada"}. Encontrado: @${result.detected}.`
          : "Não foi possível confirmar a conta do Instagram. Publicação bloqueada.",
      );
    return result;
  }
  async validateActiveAccount(id: string) {
    const a = await this.getExpectedAccount(id);
    return {
      expected: a?.expected_username ?? null,
      detected: a?.detected_username ?? null,
      match:
        !!a?.enabled &&
        a.status === "OK" &&
        !!a.detected_username &&
        normalizeInstagramHandle(a.expected_username) ===
          normalizeInstagramHandle(a.detected_username),
      status: a?.status ?? "UNKNOWN",
    };
  }
}
