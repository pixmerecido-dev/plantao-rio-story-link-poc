import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OperationsRepository } from "./operationsStorage.js";
import type { Health } from "./operationsDomain.js";
import { nowISO } from "./operationAudit.js";
const shell = promisify(execFile);
export class SystemHealthService {
  constructor(
    private store: OperationsRepository,
    private device = "emulator-5554",
  ) {}
  async check(): Promise<Health[]> {
    const t = nowISO(),
      make = (
        component: Health["component"],
        status: Health["status"],
        message: string,
      ): Health => ({ component, status, message, checked_at: t });
    const result: Health[] = [
      make(
        "APP",
        "OK",
        "Painel local disponível; adapter do motor não conectado.",
      ),
    ];
    try {
      await this.store.read();
      result.push(make("DATABASE", "OK", "Persistência local disponível."));
    } catch {
      result.push(make("DATABASE", "OFFLINE", "Persistência indisponível."));
    }
    const checks = await Promise.allSettled([
      fetch("http://127.0.0.1:4723/status", {
        signal: AbortSignal.timeout(1800),
      }).then(async (r) => {
        if (!r.ok) throw Error();
        const v = (await r.json()) as { value?: { ready?: boolean } };
        return v.value?.ready === true;
      }),
      shell(process.env.ADB_PATH || "adb", ["devices"], {
        timeout: 2000,
        maxBuffer: 65536,
      }),
    ]);
    const appium = checks[0]!;
    result.push(
      make(
        "APPIUM",
        appium.status === "fulfilled" && appium.value ? "OK" : "OFFLINE",
        "Consulta local /status; nenhuma sessão criada.",
      ),
    );
    const adb = checks[1]!;
    const devices = adb.status === "fulfilled" ? adb.value.stdout : "";
    result.push(
      make(
        "ADB",
        adb.status === "fulfilled" ? "OK" : "OFFLINE",
        adb.status === "fulfilled"
          ? "ADB disponível."
          : "ADB ausente ou indisponível.",
      ),
    );
    const connected = devices
      .split(/\r?\n/)
      .some(
        (line) =>
          line.split(/\s+/)[0] === this.device &&
          line.split(/\s+/)[1] === "device",
      );
    result.push(
      make(
        "EMULATOR",
        connected ? "OK" : "OFFLINE",
        connected
          ? "Dispositivo configurado conectado."
          : "Dispositivo configurado indisponível.",
      ),
    );
    result.push(
      make(
        "INSTAGRAM",
        "UNKNOWN",
        "Detecção confiável da conta ativa ainda não conectada.",
      ),
    );
    return result;
  }
}
