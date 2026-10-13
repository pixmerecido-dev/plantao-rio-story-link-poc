import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export type ServiceState = "OK" | "OFFLINE" | "STARTING" | "ERROR" | "UNKNOWN";
export interface ProcessRecord {
  pid: number;
  started_at: string;
  stopped_at: string | null;
  restart_count: number;
  last_exit: string | null;
  last_error: string | null;
}
export interface RuntimeState {
  version: 1;
  config: {
    sdk_path: string;
    avd: string;
    device: string;
    account_ttl_seconds: number;
    test_mode: true;
    automation_paused: boolean;
  };
  services: Record<string, { status: ServiceState; message: string }>;
  ready: boolean;
  preparing: boolean;
  processes: Record<string, ProcessRecord>;
  test: {
    id: string;
    status: "PREPARING" | "TEST_READY" | "FAILED" | "REQUIRES_REVIEW" | "ENDED";
    started_at: string;
    finished_at: string | null;
    message: string;
    artifact_directory: string;
    published: false;
  } | null;
  events: { at: string; message: string; technical: string }[];
}
const initial = (): RuntimeState => ({
  version: 1,
  config: {
    sdk_path: "",
    avd: "",
    device: "emulator-5554",
    account_ttl_seconds: 300,
    test_mode: true,
    automation_paused: true,
  },
  services: {},
  ready: false,
  preparing: false,
  processes: {},
  test: null,
  events: [],
});
export class RuntimeStore {
  private tail: Promise<unknown> = Promise.resolve();
  private state: RuntimeState | undefined;
  constructor(readonly filename: string) {}
  private async load() {
    if (this.state) return;
    await mkdir(dirname(this.filename), { recursive: true });
    try {
      const value = JSON.parse(
        await readFile(this.filename, "utf8"),
      ) as RuntimeState;
      if (
        value.version !== 1 ||
        value.config?.device !== "emulator-5554" ||
        value.config.test_mode !== true ||
        !Array.isArray(value.events)
      )
        throw Error();
      this.state = value;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error("Configuração local inválida; arquivo preservado.");
      this.state = initial();
    }
  }
  async read() {
    await this.tail;
    await this.load();
    return structuredClone(this.state!);
  }
  change<T>(fn: (state: RuntimeState) => T): Promise<T> {
    const run = this.tail.then(async () => {
      await this.load();
      const next = structuredClone(this.state!),
        result = fn(next);
      const temp = `${this.filename}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
        await rename(temp, this.filename);
      } finally {
        await unlink(temp).catch(() => {});
      }
      this.state = next;
      return result;
    });
    this.tail = run.catch(() => {});
    return run;
  }
}
export function redact(value: unknown) {
  return String(value)
    .replace(
      /((?:password|token|cookie|authorization|secret)[\s:=]+)[^\s,;]+/gi,
      "$1[oculto]",
    )
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, "$1[oculto]@")
    .slice(0, 12000);
}
export function runtimeEvent(
  s: RuntimeState,
  message: string,
  technical: unknown = "",
) {
  s.events.push({
    at: new Date().toISOString(),
    message,
    technical: redact(technical),
  });
  s.events = s.events.slice(-400);
}
