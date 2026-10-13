import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { OperationsRepository } from "../admin/operationsStorage.js";
import { InstagramAccountService } from "../admin/instagramAccountService.js";
import type { AccountDetector } from "../instagram/accountVerification.js";
import {
  RuntimeStore,
  runtimeEvent,
  type ServiceState,
} from "./runtimeStore.js";
import { findAndroidSdk, validateRuntimeConfig } from "./androidSdk.js";
import { acquireDeviceLock, isDeviceOccupied } from "./deviceLock.js";
import type { LocalHost } from "./processSupervisor.js";
export interface TestPort {
  prepare(
    id: string,
    directory: string,
  ): Promise<{ published: false; layout_confirmed: boolean }>;
  end(): Promise<void>;
}
export class RuntimeManager {
  private busy = false;
  private task: Promise<void> | null = null;
  constructor(
    readonly store: RuntimeStore,
    private operations: OperationsRepository,
    private host: LocalHost,
    private root: string,
    private detector: AccountDetector,
    private testPort: TestPort,
  ) {}
  async recover() {
    await this.store.change((s) => {
      s.ready = false;
      s.preparing = false;
      for (const service of Object.values(s.services)) {
        service.status = "UNKNOWN";
        service.message = "Verificação necessária após reinício.";
      }
      if (s.test?.status === "PREPARING") {
        s.test.status = "REQUIRES_REVIEW";
        s.test.message =
          "Teste interrompido. Confira o editor antes de tentar novamente.";
        s.test.finished_at = new Date().toISOString();
      }
      for (const p of Object.values(s.processes))
        if (!p.stopped_at) {
          p.last_error =
            "Painel reiniciado; processo antigo não será encerrado pelo PID salvo.";
        }
      runtimeEvent(
        s,
        "Painel disponível. Prepare o sistema para usar o Instagram.",
      );
    });
    await this.invalidateAccount();
  }
  private async invalidateAccount() {
    await this.operations.transact((s) => {
      for (const a of s.instagram_accounts) {
        a.status = "UNKNOWN";
        a.account_match = false;
        a.account_verified_at = null;
        a.verification_evidence = null;
      }
    });
  }
  private async service(name: string, status: ServiceState, message: string) {
    await this.store.change((s) => {
      s.services[name] = { status, message };
      runtimeEvent(s, message);
    });
  }
  async configure(input: Record<string, unknown>) {
    if (this.busy) throw Error("Aguarde a operação atual.");
    validateRuntimeConfig(input);
    await this.store.change((s) => {
      for (const key of ["sdk_path", "avd", "account_ttl_seconds"] as const)
        if (input[key] !== undefined)
          (s.config as unknown as Record<string, unknown>)[key] = input[key];
      s.ready = false;
    });
    await this.invalidateAccount();
  }
  async status() {
    const state = await this.store.read(),
      account = await new InstagramAccountService(
        this.operations,
      ).getExpectedAccount("instagram-default");
    const fresh =
      !!account?.account_match &&
      account.status === "OK" &&
      Date.now() - Date.parse(account.account_verified_at ?? "") <
        state.config.account_ttl_seconds * 1000;
    return {
      ...state,
      busy: this.busy || (await isDeviceOccupied(dirname(this.store.filename))),
      panel_available: true,
      engine_prepared: state.ready,
      account_confirmed: fresh,
      can_publish: false,
    };
  }
  private async exclusive(work: () => Promise<void>) {
    if (this.busy) throw Error("Outra operação está em andamento.");
    this.busy = true;
    try {
      await work();
    } finally {
      this.busy = false;
    }
  }
  private launch(work: () => Promise<void>) {
    if (this.busy || this.task)
      throw Error("Outra operação está em andamento.");
    this.task = this.exclusive(work)
      .catch(async (error) => {
        await this.store.change((s) => {
          s.ready = false;
          s.preparing = false;
          for (const service of Object.values(s.services))
            if (service.status === "STARTING") service.status = "ERROR";
          runtimeEvent(
            s,
            "Não foi possível concluir. Veja o diagnóstico.",
            error,
          );
          if (s.test?.status === "PREPARING") {
            s.test.status =
              error instanceof Error && error.name === "TestTimeout"
                ? "REQUIRES_REVIEW"
                : "FAILED";
            s.test.message =
              "Não foi possível concluir o teste. Nenhuma publicação foi realizada.";
            s.test.finished_at = new Date().toISOString();
          }
        });
      })
      .finally(() => {
        this.task = null;
      });
  }
  async waitForTask() {
    await this.task;
  }
  async prepare() {
    this.launch(async () => {
      const release = await acquireDeviceLock(
        "emulator-5554",
        dirname(this.store.filename),
      );
      try {
        await this.prepareServices();
      } finally {
        await release();
      }
    });
    return this.status();
  }
  private async prepareServices() {
    await this.invalidateAccount();
    await this.store.change((s) => {
      s.preparing = true;
      s.ready = false;
      runtimeEvent(s, "Preparando sistema...");
    });
    await this.operations.transact(() => true);
    await this.service("DATABASE", "OK", "Banco disponível.");
    const state = await this.store.read();
    await this.service("ANDROID", "STARTING", "Localizando Android.");
    const paths = await findAndroidSdk(this.root, state.config.sdk_path);
    await this.store.change((s) => {
      s.config.sdk_path = paths.sdk;
    });
    await this.service("ANDROID", "OK", "Android encontrado.");
    await this.host.run(paths.adb, ["start-server"]);
    let devices = await this.host.run(paths.adb, ["devices"]);
    const device = state.config.device;
    const connected = () =>
      devices
        .split(/\r?\n/)
        .some(
          (line) =>
            line.trim().split(/\s+/)[0] === device &&
            line.trim().split(/\s+/)[1] === "device",
        );
    if (!connected()) {
      if (new RegExp(`^${device}\\s+offline`, "m").test(devices)) {
        await this.host.run(paths.adb, ["-s", device, "reconnect"]);
        devices = await this.host.run(paths.adb, ["devices"]);
      }
      if (!connected() && !devices.includes(device)) {
        const avds = (await this.host.run(paths.emulator, ["-list-avds"]))
          .split(/\r?\n/)
          .map((v) => v.trim())
          .filter((v) => /^[\w.-]+$/.test(v));
        const avd =
          state.config.avd || (avds.length === 1 ? avds.find(() => true) : "");
        if (!avd || !avds.includes(avd))
          throw Error("Selecione o emulador em Configurações do sistema.");
        for (const line of devices.split(/\r?\n/)) {
          const [serial, status] = line.trim().split(/\s+/);
          if (
            serial?.startsWith("emulator-") &&
            serial !== device &&
            status === "device"
          ) {
            const name = await this.host.run(paths.adb, [
              "-s",
              serial,
              "emu",
              "avd",
              "name",
            ]);
            if (name.split(/\r?\n/).includes(avd))
              throw Error(
                "Esse emulador já está aberto em outro dispositivo; não será criada outra instância.",
              );
          }
        }
        await this.store.change((s) => {
          s.config.avd = avd;
        });
        await this.host.start("emulator", paths.emulator, [
          "-avd",
          avd,
          "-port",
          "5554",
          "-no-snapshot-save",
        ]);
      }
    }
    await this.service("EMULATOR", "STARTING", "Aguardando o Android iniciar.");
    let boot = false;
    for (let n = 0; n < 120; n++) {
      devices = await this.host.run(paths.adb, ["devices"]);
      if (connected())
        try {
          boot =
            (
              await this.host.run(
                paths.adb,
                ["-s", device, "shell", "getprop", "sys.boot_completed"],
                3000,
              )
            ).trim() === "1";
        } catch {
          /* boot not yet */
        }
      if (boot) break;
      await this.host.delay(1000);
    }
    if (!boot) throw Error("Emulador não concluiu a inicialização.");
    const actualAvd = (
      await this.host.run(paths.adb, ["-s", device, "emu", "avd", "name"])
    )
      .split(/\r?\n/)
      .find((v) => v && v !== "OK");
    if (state.config.avd && actualAvd !== state.config.avd)
      throw Error("O emulador aberto é diferente do configurado.");
    if (!state.config.avd && actualAvd && /^[\w.-]+$/.test(actualAvd))
      await this.store.change((s) => {
        s.config.avd = actualAvd;
      });
    await this.service("EMULATOR", "OK", "Emulador conectado.");
    await this.service("ADB", "OK", "Comunicação com Android disponível.");
    if (!(await this.host.appiumReady())) {
      if (await this.host.portOccupied())
        throw Error(
          "Serviço existente não responde; consulte o administrador. Nenhuma segunda instância iniciada.",
        );
      await this.service(
        "APPIUM",
        "STARTING",
        "Iniciando conexão com Instagram.",
      );
      await this.host.start(
        "appium",
        process.execPath,
        [
          join(this.root, "node_modules/appium/index.js"),
          "--address",
          "127.0.0.1",
          "--port",
          "4723",
        ],
        {
          ...process.env,
          ANDROID_HOME: paths.sdk,
          ANDROID_SDK_ROOT: paths.sdk,
        },
      );
      let ready = false;
      for (let n = 0; n < 40; n++) {
        if (await this.host.appiumReady()) {
          ready = true;
          break;
        }
        await this.host.delay(500);
      }
      if (!ready) throw Error("Conexão com Instagram não iniciou.");
    }
    await this.service("APPIUM", "OK", "Conexão com Instagram disponível.");
    if (
      !(
        await this.host.run(paths.adb, [
          "-s",
          device,
          "shell",
          "pm",
          "path",
          "com.instagram.android",
        ])
      ).includes("package:")
    )
      throw Error(
        "Instagram não está instalado. Instale e faça login manualmente.",
      );
    // Launch only the installed public app; preserve login/storage and existing draft.
    await this.host.run(paths.adb, [
      "-s",
      device,
      "shell",
      "monkey",
      "-p",
      "com.instagram.android",
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ]);
    await this.host.delay(1500);
    const focus = await this.host.run(paths.adb, [
      "-s",
      device,
      "shell",
      "dumpsys",
      "window",
      "windows",
    ]);
    if (
      !/mCurrentFocus[^\n]*com\.instagram\.android|mFocusedApp[^\n]*com\.instagram\.android/.test(
        focus,
      )
    )
      throw Error(
        "Instagram não respondeu. Abra o aplicativo e tente novamente.",
      );
    await this.service("INSTAGRAM", "OK", "Instagram disponível.");
    await this.store.change((s) => {
      s.ready = true;
      s.preparing = false;
      runtimeEvent(s, "Sistema pronto para verificar a conta.");
    });
  }
  async detectAccount(selector?: string) {
    if (this.busy) throw Error("Aguarde a operação atual.");
    this.busy = true;
    try {
      const s = await this.store.read();
      if (!s.ready)
        throw Error("Prepare o sistema antes de verificar a conta.");
      if (!(await this.host.appiumReady()))
        throw Error("Conexão indisponível. Prepare o sistema novamente.");
      return await this.detector(selector);
    } finally {
      this.busy = false;
    }
  }
  async startTest() {
    const state = await this.status();
    if (!state.ready) throw Error("Prepare o sistema primeiro.");
    if (!state.account_confirmed)
      throw Error(
        "Publicação bloqueada até a confirmação da conta do Instagram. Verifique a conta antes do teste.",
      );
    if (state.test?.status === "TEST_READY")
      throw Error("Encerre o teste anterior antes de preparar outro.");
    const id = `test-${randomUUID()}`,
      directory = join(this.root, "artifacts", id);
    this.launch(async () => {
      await this.store.change((s) => {
        s.test = {
          id,
          status: "PREPARING",
          started_at: new Date().toISOString(),
          finished_at: null,
          message: "Preparando Story de teste...",
          artifact_directory: directory,
          published: false,
        };
      });
      const result = await this.testPort.prepare(id, directory);
      if (result.published !== false || !result.layout_confirmed)
        throw Error("Teste não confirmou layout seguro.");
      await this.store.change((s) => {
        s.test!.status = "TEST_READY";
        s.test!.finished_at = new Date().toISOString();
        s.test!.message =
          "Story preparado com sucesso. Nenhuma publicação foi realizada.";
        runtimeEvent(s, s.test!.message);
      });
    });
    return this.status();
  }
  async endTest() {
    this.launch(async () => {
      await this.testPort.end();
      await this.store.change((s) => {
        if (s.test) {
          s.test.status = "ENDED";
          s.test.message = "Teste encerrado. Nenhuma publicação realizada.";
        }
        runtimeEvent(s, "Teste encerrado.");
      });
    });
    return this.status();
  }
  async control(action: string) {
    if (action === "pause" || action === "resume") {
      await this.store.change((s) => {
        s.config.automation_paused = action === "pause";
        runtimeEvent(
          s,
          action === "pause"
            ? "Automação pausada; operação atual preservada."
            : "Automação disponível para uso futuro; publicação permanece desativada.",
        );
      });
      return;
    }
    if (this.busy) throw Error("Aguarde a operação atual.");
    const release = await acquireDeviceLock(
      "emulator-5554",
      dirname(this.store.filename),
    );
    this.busy = true;
    try {
      await this.invalidateAccount();
      await this.store.change((s) => {
        s.ready = false;
      });
      if (action === "stop-appium" || action === "restart-appium")
        await this.host.stop("appium");
      else if (action === "restart-emulator") {
        const s = await this.store.read();
        const paths = await findAndroidSdk(this.root, s.config.sdk_path);
        await this.host.run(paths.adb, ["-s", s.config.device, "emu", "kill"]);
        let stopped = false;
        for (let n = 0; n < 30; n++) {
          const devices = await this.host.run(paths.adb, ["devices"]);
          if (!devices.includes(s.config.device)) {
            stopped = true;
            break;
          }
          await this.host.delay(1000);
        }
        if (!stopped) throw Error("Emulador não encerrou; reinício cancelado.");
      } else throw Error("Ação não suportada.");
    } finally {
      this.busy = false;
      await release();
    }
    if (action === "restart-appium" || action === "restart-emulator")
      await this.prepare();
  }
  async refresh() {
    const state = await this.store.read();
    if (this.busy) return this.status();
    await this.service(
      "DATABASE",
      "OK",
      (await this.operations.read())
        ? "Banco disponível."
        : "Banco indisponível.",
    );
    try {
      const paths = await findAndroidSdk(this.root, state.config.sdk_path);
      const devices = await this.host.run(paths.adb, ["devices"], 3000);
      const online = devices
        .split(/\r?\n/)
        .some(
          (line) =>
            line.trim().split(/\s+/)[0] === state.config.device &&
            line.trim().split(/\s+/)[1] === "device",
        );
      const boot =
        online &&
        (
          await this.host.run(
            paths.adb,
            [
              "-s",
              state.config.device,
              "shell",
              "getprop",
              "sys.boot_completed",
            ],
            3000,
          )
        ).trim() === "1";
      const appium = await this.host.appiumReady();
      await this.service("ADB", "OK", "Comunicação disponível.");
      await this.service(
        "EMULATOR",
        boot ? "OK" : online ? "STARTING" : "OFFLINE",
        boot
          ? "Emulador conectado."
          : "Emulador indisponível ou inicializando.",
      );
      await this.service(
        "APPIUM",
        appium ? "OK" : "OFFLINE",
        appium ? "Conexão disponível." : "Conexão indisponível.",
      );
      if (!boot || !appium) {
        await this.store.change((s) => {
          s.ready = false;
        });
        await this.invalidateAccount();
      }
    } catch (error) {
      await this.store.change((s) => {
        s.ready = false;
        runtimeEvent(s, "Android indisponível.", error);
      });
      await this.service("EMULATOR", "OFFLINE", "Android indisponível.");
      await this.invalidateAccount();
    }
    return this.status();
  }
  async listAvds() {
    const state = await this.store.read();
    const paths = await findAndroidSdk(this.root, state.config.sdk_path);
    return (await this.host.run(paths.emulator, ["-list-avds"]))
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter((v) => /^[A-Za-z0-9_.-]+$/.test(v));
  }
  private closeApplication: (() => void) | null = null;
  onCloseApplication(close: () => void) {
    this.closeApplication = close;
  }
  async stopApplication() {
    if (this.busy || this.task)
      throw Error("Aguarde a operação atual antes de encerrar.");
    if (!this.closeApplication) throw Error("Encerramento indisponível.");
    const release = await acquireDeviceLock(
      "emulator-5554",
      dirname(this.store.filename),
    );
    this.busy = true;
    try {
      await this.invalidateAccount();
      if (this.host.owned("appium")) await this.host.stop("appium");
      if (this.host.owned("emulator")) {
        const state = await this.store.read();
        const paths = await findAndroidSdk(this.root, state.config.sdk_path);
        await this.host.run(paths.adb, [
          "-s",
          state.config.device,
          "emu",
          "kill",
        ]);
      }
      await this.store.change((s) => {
        s.ready = false;
        runtimeEvent(
          s,
          "Aplicativo encerrado. Fila e configurações preservadas.",
        );
      });
      setTimeout(() => this.closeApplication?.(), 200);
    } finally {
      this.busy = false;
      await release();
    }
  }
  async shutdown() {
    await this.task;
  }
}
