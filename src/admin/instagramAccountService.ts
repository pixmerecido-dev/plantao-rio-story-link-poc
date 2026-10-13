import type { OperationsRepository } from "./operationsStorage.js";
import { ValidationError } from "./domain.js";
import { audit, nowISO } from "./operationAudit.js";
export const normalizeInstagramHandle = (value: string) =>
  value.trim().replace(/^@/, "").toLowerCase();
export class InstagramAccountService {
  constructor(
    private store: OperationsRepository,
    private detector?: () => Promise<{
      username: string | null;
      status: "OK" | "LOGGED_OUT" | "UNAVAILABLE";
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
      audit(s, `account.${id}`, before, a);
      return a;
    });
  }
  async detectCurrentAccount(id: string) {
    const detection = this.detector ? await this.detector() : null;
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
      return a;
    });
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
