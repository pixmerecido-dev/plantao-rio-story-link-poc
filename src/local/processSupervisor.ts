import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeStore } from "./runtimeStore.js";
import { redact, runtimeEvent } from "./runtimeStore.js";
const exec = promisify(execFile);
export interface LocalHost {
  run(file: string, args: string[], timeout?: number): Promise<string>;
  start(
    name: string,
    file: string,
    args: string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<number>;
  stop(name: string): Promise<void>;
  owned(name: string): boolean;
  delay(ms: number): Promise<void>;
  appiumReady(): Promise<boolean>;
  portOccupied(): Promise<boolean>;
}
export class ProcessSupervisor implements LocalHost {
  private exits = new Map<string, Promise<number | null>>();
  private children = new Map<string, ChildProcess>();
  constructor(
    private store: RuntimeStore,
    private root: string,
  ) {}
  async run(file: string, args: string[], timeout = 10000) {
    try {
      const result = await exec(file, args, {
        timeout,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        cwd: this.root,
      });
      await this.store.change((s) =>
        runtimeEvent(
          s,
          "Diagnóstico atualizado.",
          `${file} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
        ),
      );
      return result.stdout;
    } catch (error) {
      await this.store.change((s) =>
        runtimeEvent(s, "Não foi possível concluir uma verificação.", error),
      );
      throw error;
    }
  }
  owned(name: string) {
    return this.children.has(name);
  }
  async start(name: string, file: string, args: string[], env = process.env) {
    if (this.children.has(name))
      throw Error("Serviço já iniciado por este painel.");
    const child = spawn(file, args, {
      cwd: this.root,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.children.set(name, child);
    child.stdout?.on("data", (v) => {
      void this.store
        .change((s) => runtimeEvent(s, "Serviço em execução.", `${name}: ${v}`))
        .catch(() => {});
    });
    child.stderr?.on("data", (v) => {
      void this.store
        .change((s) => {
          if (s.processes[name]) s.processes[name]!.last_error = redact(v);
          runtimeEvent(
            s,
            "Diagnóstico do serviço atualizado.",
            `${name}: ${v}`,
          );
        })
        .catch(() => {});
    });
    this.exits.set(
      name,
      new Promise((ok) => child.once("exit", (code) => ok(code))),
    );
    child.on("exit", (code, signal) => {
      this.children.delete(name);
      void this.store
        .change((s) => {
          const p = s.processes[name];
          if (p) {
            p.stopped_at = new Date().toISOString();
            p.last_exit = `code=${code} signal=${signal}`;
          }
          if (name === "appium" || name === "emulator") {
            s.ready = false;
            s.services[name.toUpperCase()] = {
              status: "OFFLINE",
              message: "Serviço encerrado.",
            };
          }
          runtimeEvent(
            s,
            "Serviço encerrado.",
            `${name} code=${code} signal=${signal}`,
          );
        })
        .catch(() => {});
    });
    await new Promise<void>((ok, no) => {
      child.once("spawn", ok);
      child.once("error", no);
    }).catch(async (error) => {
      this.children.delete(name);
      await this.store.change((s) =>
        runtimeEvent(s, "Não foi possível iniciar serviço.", error),
      );
      throw error;
    });
    await this.store.change((s) => {
      const old = s.processes[name];
      s.processes[name] = {
        pid: child.pid!,
        started_at: new Date().toISOString(),
        stopped_at:
          child.exitCode !== null || child.signalCode !== null
            ? new Date().toISOString()
            : null,
        restart_count: old ? old.restart_count + 1 : 0,
        last_exit:
          child.exitCode !== null || child.signalCode !== null
            ? `code=${child.exitCode} signal=${child.signalCode}`
            : null,
        last_error: null,
      };
      runtimeEvent(s, "Serviço iniciado.", `${name} pid=${child.pid}`);
    });
    return child.pid!;
  }
  async stop(name: string) {
    const child = this.children.get(name);
    if (!child)
      throw Error(
        "Este serviço não foi iniciado pelo painel; encerramento automático bloqueado.",
      );
    child.kill("SIGTERM");
    await new Promise<void>((ok, no) => {
      if (child.exitCode !== null) return ok();
      const timer = setTimeout(
        () => no(Error("Serviço não encerrou; não foi forçado.")),
        10000,
      );
      child.once("exit", () => {
        clearTimeout(timer);
        ok();
      });
    });
  }
  delay(ms: number) {
    return new Promise<void>((ok) => setTimeout(ok, ms));
  }
  async appiumReady() {
    try {
      const r = await fetch("http://127.0.0.1:4723/status", {
        signal: AbortSignal.timeout(1800),
      });
      if (!r.ok) return false;
      const value = (await r.json()) as { value?: { ready?: boolean } };
      return value.value?.ready === true;
    } catch {
      return false;
    }
  }
  async portOccupied() {
    const { createConnection } = await import("node:net");
    return new Promise<boolean>((ok) => {
      const socket = createConnection({ host: "127.0.0.1", port: 4723 });
      const finish = (v: boolean) => {
        socket.destroy();
        ok(v);
      };
      socket.setTimeout(1000, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    });
  }
  async wait(name: string, timeoutMs = 600000) {
    const result = this.exits.get(name);
    if (!result) throw Error("Processo não acompanhado.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await Promise.race([
        result,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(
              "Teste interrompido por tempo limite; confira o editor. Nenhuma publicação foi realizada.",
            );
            error.name = "TestTimeout";
            reject(error);
          }, timeoutMs);
        }),
      ]);
      if (code !== 0)
        throw Error("Processo de teste não concluiu; consulte os logs.");
    } catch (error) {
      // Only this dedicated test child is stopped, never a real publisher/external PID.
      if (
        error instanceof Error &&
        error.name === "TestTimeout" &&
        name === "worker" &&
        this.owned(name)
      )
        await this.stop(name);
      throw error;
    } finally {
      clearTimeout(timer);
      this.exits.delete(name);
    }
  }
  async shutdown() {
    for (const name of ["appium", "emulator"])
      if (this.owned(name))
        await this.stop(name).catch(async (error) => {
          await this.store.change((s) =>
            runtimeEvent(s, "Encerramento precisa de revisão.", error),
          );
        });
  }
}
