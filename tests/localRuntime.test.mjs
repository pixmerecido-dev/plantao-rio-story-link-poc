import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { RuntimeStore, redact } from "../dist/local/runtimeStore.js";
import { RuntimeManager, parseAdbAvdName } from "../dist/local/runtimeManager.js";
import { OperationsStorage } from "../dist/admin/operationsStorage.js";
import { InstagramAccountService } from "../dist/admin/instagramAccountService.js";
import { acquireDeviceLock } from "../dist/local/deviceLock.js";
import {
  findAndroidSdk,
  validateRuntimeConfig,
} from "../dist/local/androidSdk.js";
import { createAdminServer } from "../dist/admin/httpServer.js";
import { JsonStorage } from "../dist/admin/jsonStorage.js";
async function fixture({
  online = true,
  absent = false,
  boot = 1,
  appium = true,
  occupied = false,
  installed = true,
  focus = true,
} = {}) {
  const root = await mkdtemp("/tmp/local-runtime-");
  const sdk = join(root, "sdk");
  await mkdir(join(sdk, "platform-tools"), { recursive: true });
  await mkdir(join(sdk, "emulator"));
  await writeFile(join(sdk, "platform-tools/adb"), "");
  await writeFile(join(sdk, "emulator/emulator"), "");
  const store = new RuntimeStore(join(root, "data/admin/runtime.json")),
    ops = new OperationsStorage(join(root, "data/admin/operations.json"));
  await store.change((s) => {
    s.config.sdk_path = sdk;
    s.config.avd = "Test_AVD";
  });
  const calls = [],
    starts = [],
    stops = [];
  const host = {
    run: async (file, args) => {
      calls.push(args);
      if (args[0] === "devices")
        return `List of devices attached\n${absent ? "" : online ? "emulator-5554\tdevice" : "emulator-5554\toffline"}\n`;
      if (args[0] === "-list-avds") return "Test_AVD\n";
      if (args.includes("getprop")) return String(boot);
      if (args.includes("name")) return "Test_AVD\nOK";
      if (args.includes("pm"))
        return installed ? "package:/data/instagram/base.apk" : "";
      if (args.includes("dumpsys"))
        return focus
          ? "mCurrentFocus=Window{ u0 com.instagram.android/com.instagram.Main }"
          : "";
      return "";
    },
    start: async (name) => {
      starts.push(name);
      if (name === "emulator") {
        online = true;
        absent = false;
        boot = 1;
      }
      if (name === "appium") appium = true;
      return 123;
    },
    stop: async (name) => {
      stops.push(name);
      appium = false;
    },
    owned: () => true,
    delay: async () => {},
    appiumReady: async () => appium,
    portOccupied: async () => occupied,
  };
  const detector = async () => ({
    username: "plantaorio",
    status: "OK",
    evidence: {
      profile_selected: true,
      username_resource_id: "TEST_ONLY_username",
      captured_at: new Date().toISOString(),
    },
  });
  let testCount = 0,
    endCount = 0;
  const port = {
    prepare: async () => {
      testCount++;
      return { published: false, layout_confirmed: true };
    },
    end: async () => {
      endCount++;
    },
  };
  const manager = new RuntimeManager(store, ops, host, root, detector, port);
  const account = new InstagramAccountService(ops, detector);
  await account.configure("instagram-default", {
    expected_username: "plantaorio",
    display_name: "Plantão Rio",
    enabled: true,
  });
  return {
    root,
    sdk,
    store,
    ops,
    host,
    calls,
    starts,
    stops,
    manager,
    account,
    counts: () => ({ testCount, endCount }),
  };
}
test("preparar reutiliza serviços ativos e abre Instagram fechado sem nova instância", async () => {
  const f = await fixture();
  await f.manager.prepare();
  await f.manager.waitForTask();
  assert.equal((await f.manager.status()).ready, true);
  assert.deepEqual(f.starts, []);
  assert.ok(f.calls.some((a) => a.includes("monkey")));
  assert.equal((await f.manager.status()).can_publish, false);
});
test("Appium parado inicia uma vez; duplo clique fica bloqueado", async () => {
  const f = await fixture({ appium: false });
  await f.manager.prepare();
  await assert.rejects(f.manager.prepare(), /andamento/);
  await f.manager.waitForTask();
  assert.deepEqual(f.starts, ["appium"]);
  await f.manager.prepare();
  await f.manager.waitForTask();
  assert.deepEqual(f.starts, ["appium"]);
});
test("porta Appium ocupada e inválida nunca inicia segunda cópia", async () => {
  const f = await fixture({ appium: false, occupied: true });
  await f.manager.prepare();
  await f.manager.waitForTask();
  assert.equal((await f.manager.status()).ready, false);
  assert.deepEqual(f.starts, []);
});
test("emulador offline/boot incompleto não inicia uma segunda instância e falha seguro", async () => {
  for (const options of [{ online: false }, { boot: 0 }]) {
    const f = await fixture(options);
    await f.manager.prepare();
    await f.manager.waitForTask();
    assert.equal((await f.manager.status()).ready, false);
    assert.deepEqual(f.starts, []);
  }
});
test("Instagram ausente ou sem responder impede motor preparado", async () => {
  for (const options of [{ installed: false }, { focus: false }]) {
    const f = await fixture(options);
    await f.manager.prepare();
    await f.manager.waitForTask();
    assert.equal((await f.manager.status()).ready, false);
  }
});
test("conta certa permite somente teste; divergente, desconhecida e expirada bloqueiam", async () => {
  const f = await fixture();
  await f.manager.prepare();
  await f.manager.waitForTask();
  await assert.rejects(f.manager.startTest(), /confirmação/);
  await f.account.detectCurrentAccount("instagram-default");
  await f.manager.startTest();
  await assert.rejects(f.manager.startTest(), /andamento|anterior/);
  await f.manager.waitForTask();
  assert.deepEqual(f.counts(), { testCount: 1, endCount: 0 });
  assert.equal((await f.manager.status()).test.published, false);
  await assert.rejects(f.manager.startTest(), /anterior/);
  await f.manager.endTest();
  await f.manager.waitForTask();
  for (const status of ["MISMATCH", "UNKNOWN"]) {
    await f.ops.transact((s) => {
      s.instagram_accounts[0].status = status;
      s.instagram_accounts[0].account_match = false;
    });
    await assert.rejects(f.manager.startTest(), /confirmação/);
  }
  await f.account.detectCurrentAccount("instagram-default");
  await f.ops.transact((s) => {
    s.instagram_accounts[0].account_verified_at = "2020-01-01T00:00:00Z";
  });
  await assert.rejects(f.manager.startTest(), /confirmação/);
});
test("restart do backend invalida conta e marca teste interrompido para revisão", async () => {
  const f = await fixture();
  await f.account.detectCurrentAccount("instagram-default");
  await f.store.change((s) => {
    s.ready = true;
    s.test = {
      id: "test-id",
      status: "PREPARING",
      started_at: new Date().toISOString(),
      finished_at: null,
      message: "",
      artifact_directory: f.root,
      published: false,
    };
  });
  const again = new RuntimeStore(f.store.filename);
  const manager = new RuntimeManager(
    again,
    f.ops,
    f.host,
    f.root,
    async () => ({ username: null, status: "UNKNOWN" }),
    {
      prepare: async () => {
        throw Error("não deve repetir");
      },
      end: async () => {},
    },
  );
  await manager.recover();
  assert.equal((await manager.status()).test.status, "REQUIRES_REVIEW");
  assert.equal((await manager.status()).ready, false);
  assert.equal(
    (await f.account.validateActiveAccount("instagram-default")).match,
    false,
  );
});
test("trava real bloqueia dois workers e libera somente o proprietário", async () => {
  const folder = await mkdtemp("/tmp/device-lock-");
  const release = await acquireDeviceLock("emulator-5554", folder);
  await assert.rejects(acquireDeviceLock("emulator-5554", folder), /ocupado/);
  await release();
  const again = await acquireDeviceLock("emulator-5554", folder);
  await again();
});
test("trava órfã de processo morto é recuperada; arquivo corrompido não é apagado", async () => {
  const folder = await mkdtemp("/tmp/device-stale-");
  const filename = join(folder, "device-emulator-5554.lock");
  await writeFile(filename, JSON.stringify({ pid: 2147483647, token: "old" }));
  const release = await acquireDeviceLock("emulator-5554", folder);
  await release();
  await writeFile(filename, "broken");
  await assert.rejects(acquireDeviceLock("emulator-5554", folder), /revisão/);
  assert.equal(await readFile(filename, "utf8"), "broken");
});
test("SDK prioriza persistido e properties antes de ambiente; modo teste não pode desligar", async () => {
  const f = await fixture();
  assert.equal(
    (await findAndroidSdk(f.root, f.sdk, { ANDROID_HOME: "/missing" })).sdk,
    f.sdk,
  );
  await writeFile(join(f.root, "local.properties"), `sdk.dir=${f.sdk}`);
  assert.equal(
    (await findAndroidSdk(f.root, "", { ANDROID_HOME: "/missing" })).sdk,
    f.sdk,
  );
  assert.throws(() => validateRuntimeConfig({ test_mode: false }), /Teste/);
  assert.throws(() => validateRuntimeConfig({ avd: "test;rm" }));
  assert.equal(
    redact("token=abc password:def"),
    "token=[oculto] password:[oculto]",
  );
});
test("HTTP runtime respeita origem, modo teste e não oferece publicação", async () => {
  const f = await fixture();
  const repository = new JsonStorage(join(f.root, "admin.json"));
  const server = createAdminServer({
    repository,
    root: f.root,
    runtime: f.manager,
    operationsStore: f.ops,
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await (await fetch(url + "/api/runtime")).json();
    assert.equal(status.test_mode, true);
    assert.equal(status.can_publish, false);
    assert.equal(status.panel_available, true);
    assert.equal(
      (
        await fetch(url + "/api/runtime/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await fetch(url + "/api/runtime/prepare", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Request": "local",
            Origin: "https://evil.example",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal((await fetch(url + "/api/runtime/publish")).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  }
});

test("supervisão acompanha PID/saída e mascara stdout sem executar Android", async () => {
  const { ProcessSupervisor } = await import(
    "../dist/local/processSupervisor.js"
  );
  const f = await fixture();
  const host = new ProcessSupervisor(f.store, f.root);
  await host.start("worker", process.execPath, [
    "-e",
    'console.log("token=confidential");setTimeout(()=>process.exit(0),30)',
  ]);
  await host.wait("worker");
  const state = await f.store.read();
  assert.ok(state.processes.worker.pid > 0);
  assert.ok(state.processes.worker.started_at);
  assert.ok(state.processes.worker.stopped_at);
  assert.match(state.processes.worker.last_exit, /code=0/);
  assert.ok(!JSON.stringify(state.events).includes("confidential"));
  await host.start("worker", process.execPath, [
    "-e",
    "setInterval(()=>{},1000)",
  ]);
  await assert.rejects(
    host.start("worker", process.execPath, ["-e", "process.exit(0)"]),
    /iniciado/,
  );
  await host.stop("worker");
  assert.equal(host.owned("worker"), false);
});
test("mídia ausente impede worker antes de abrir conexão", async () => {
  const { panelTestPort } = await import("../dist/local/panelTestPort.js");
  const f = await fixture();
  let starts = 0;
  const host = {
    start: async () => {
      starts++;
    },
    wait: async () => {},
  };
  const repository = {
    getSettings: async () =>
      (await import("../dist/admin/domain.js")).defaultSettings(),
  };
  const port = panelTestPort(host, f.store, repository, f.root, f.ops);
  await assert.rejects(port.prepare("missing-media", join(f.root, "artifact")));
  assert.equal(starts, 0);
});
test("dois processos reais concorrendo não compartilham lease do dispositivo", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const folder = await mkdtemp("/tmp/device-processes-");
  const release = await acquireDeviceLock("emulator-5554", folder);
  const moduleUrl = new URL("../dist/local/deviceLock.js", import.meta.url)
    .href;
  const script = `import {acquireDeviceLock} from ${JSON.stringify(moduleUrl)};try{await acquireDeviceLock('emulator-5554',process.argv[1]);process.exitCode=9;}catch{console.log('BLOCKED');}`;
  const result = await run(process.execPath, [
    "--input-type=module",
    "-e",
    script,
    folder,
  ]);
  assert.match(result.stdout, /BLOCKED/);
  await release();
});
test("encerramento e reinício são recusados durante controle externo do dispositivo", async () => {
  const f = await fixture();
  let closed = false;
  f.manager.onCloseApplication(() => {
    closed = true;
  });
  const release = await acquireDeviceLock(
    "emulator-5554",
    join(f.root, "data/admin"),
  );
  await assert.rejects(f.manager.stopApplication(), /ocupado/);
  await assert.rejects(f.manager.control("restart-emulator"), /ocupado/);
  assert.equal(closed, false);
  assert.deepEqual(f.stops, []);
  await release();
});

test("emulador fechado inicia AVD configurado uma vez e espera boot", async () => {
  const f = await fixture({ absent: true });
  await f.manager.prepare();
  await f.manager.waitForTask();
  assert.deepEqual(f.starts, ["emulator"]);
  assert.equal((await f.manager.status()).ready, true);
});

test("Modo Teste padrão/persistido bloqueia publicação mesmo com opt-ins reais", async () => {
  const { assertNotInTestMode } = await import(
    "../dist/local/publicationMode.js"
  );
  const root = await mkdtemp("/tmp/test-mode-");
  assert.throws(() => assertNotInTestMode({ ADMIN_DATA_DIR: root }), /Teste/);
  assert.doesNotThrow(() =>
    assertNotInTestMode({ ADMIN_DATA_DIR: root, STORY_TEST_MODE: "false" }),
  );
  await writeFile(
    join(root, "runtime.json"),
    JSON.stringify({ version: 1, config: { test_mode: true } }),
  );
  assert.throws(
    () =>
      assertNotInTestMode({
        ADMIN_DATA_DIR: root,
        STORY_TEST_MODE: "false",
        ALLOW_PUBLISH: "true",
        CONFIRM_REAL_PUBLISH: "YES",
      }),
    /Teste/,
  );
  await writeFile(join(root, "runtime.json"), "bad");
  assert.throws(
    () =>
      assertNotInTestMode({ ADMIN_DATA_DIR: root, STORY_TEST_MODE: "false" }),
    /revisão/,
  );
});

test("pausar durante teste não mata worker; retomar não inicia outro job", async () => {
  const f = await fixture();
  await f.manager.prepare();
  await f.manager.waitForTask();
  await f.account.detectCurrentAccount("instagram-default");
  let complete, started;
  const entered = new Promise((ok) => (started = ok));
  const hold = new Promise((ok) => (complete = ok));
  let count = 0;
  const manager = new RuntimeManager(
    f.store,
    f.ops,
    f.host,
    f.root,
    async () => ({ username: null, status: "UNKNOWN" }),
    {
      prepare: async () => {
        count++;
        started();
        await hold;
        return { published: false, layout_confirmed: true };
      },
      end: async () => {},
    },
  );
  await manager.startTest();
  await entered;
  await manager.control("pause");
  assert.equal((await manager.status()).busy, true);
  assert.equal((await manager.status()).config.automation_paused, true);
  await manager.control("resume");
  assert.equal(count, 1);
  complete();
  await manager.waitForTask();
  assert.equal((await manager.status()).test.status, "TEST_READY");
  assert.equal(count, 1);
});

test("watchdog encerra somente filho de teste travado e registra interrupção", async () => {
  const { ProcessSupervisor } = await import(
    "../dist/local/processSupervisor.js"
  );
  const f = await fixture();
  const host = new ProcessSupervisor(f.store, f.root);
  await host.start("worker", process.execPath, [
    "-e",
    "setInterval(()=>{},1000)",
  ]);
  await assert.rejects(
    host.wait("worker", 50),
    (e) => e.name === "TestTimeout",
  );
  assert.equal(host.owned("worker"), false);
  assert.ok((await f.store.read()).processes.worker.stopped_at);
});

test('parser AVD normaliza CR/LF, espaços, linhas vazias e ignora OK', () => {
  for (const response of [
    'Medium_Phone_API_37.0\nOK\n',
    'Medium_Phone_API_37.0\r\nOK\r\n',
    'Medium_Phone_API_37.0\r\r\nOK\r\r\n\n',
    '\r\n OK \r\r\n\tMedium_Phone_API_37.0 \r\n\n',
    'Medium_Phone_API_37.0\rOK\r',
  ]) assert.equal(parseAdbAvdName(response), 'Medium_Phone_API_37.0');
  for (const response of ['', '\r\r\n OK \r\n', 'Test_AVD\nOther_AVD\nOK', 'KO: emulator unavailable\nOK'])
    assert.throws(() => parseAdbAvdName(response), /inequivocamente/);
});

test('resposta Windows CRCRLF permite continuar até Appium sem alterar AVD configurado', async () => {
  const f = await fixture({ appium: false });
  const run = f.host.run;
  f.host.run = async (file, args) => args.includes('name') ? 'Test_AVD\r\r\nOK\r\r\n\n' : run(file, args);
  await f.manager.prepare();
  await f.manager.waitForTask();
  assert.equal((await f.manager.status()).ready, true);
  assert.equal((await f.store.read()).config.avd, 'Test_AVD');
  assert.deepEqual(f.starts, ['appium']); // Simulated only; no Appium/emulator started in cloud.
});

test('AVD diferente ou resposta ambígua ainda aborta antes do Appium', async () => {
  for (const response of ['Other_AVD\r\r\nOK\r\r\n', 'Test_AVD\r\nOther_AVD\r\nOK\r\n']) {
    const f = await fixture({ appium: false });
    const run = f.host.run;
    f.host.run = async (file, args) => args.includes('name') ? response : run(file, args);
    await f.manager.prepare();
    await f.manager.waitForTask();
    const state = await f.store.read();
    assert.equal(state.ready, false);
    assert.equal(state.config.avd, 'Test_AVD');
    assert.deepEqual(f.starts, []);
    assert.ok(state.events.some(e => /diferente do configurado|inequivocamente/.test(e.technical)));
  }
});

test('mesmo AVD em outro dispositivo com CRCRLF não inicia segunda instância', async () => {
  const f = await fixture({ absent: true, appium: false });
  const run = f.host.run;
  f.host.run = async (file, args) => args[0] === 'devices'
    ? 'List of devices attached\r\nemulator-5556\tdevice\r\n'
    : args.includes('name') ? 'Test_AVD\r\r\nOK\r\r\n' : run(file, args);
  await f.manager.prepare();
  await f.manager.waitForTask();
  assert.equal((await f.store.read()).ready, false);
  assert.deepEqual(f.starts, []);
  assert.ok((await f.store.read()).events.some(e => /já está aberto/.test(e.technical)));
});

test('confirmação sem preparação apresenta orientação por HTTP sem acessar detector', async () => {
  const f = await fixture();
  const server = createAdminServer({repository: new JsonStorage(join(f.root,'admin.json')),root:f.root,operationsStore:f.ops,runtime:f.manager,accountDetector:s=>f.manager.detectAccount(s)});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/operations/account/detect`,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Request':'local'},body:'{}'});
    assert.equal(response.status,400);
    assert.match((await response.json()).error,/Prepare o sistema em Diagnóstico/);
    assert.equal((await f.store.read()).ready,false);
    assert.equal((await f.account.validateActiveAccount('instagram-default')).match,false);
    assert.ok((await f.store.read()).events.some(e=>/antes de verificar/.test(e.message)));
  } finally { server.closeAllConnections();await new Promise(ok=>server.close(ok)); }
});

test('perda da conexão invalida confirmação anterior e dá orientação específica', async () => {
  const f=await fixture();await f.manager.prepare();await f.manager.waitForTask();await f.account.detectCurrentAccount('instagram-default');
  f.host.appiumReady=async()=>false;
  await assert.rejects(f.manager.detectAccount(),/Conexão com Instagram indisponível/);
  assert.equal((await f.manager.status()).ready,false);
  assert.equal((await f.account.validateActiveAccount('instagram-default')).match,false);
});

test('tela mostra bloqueio conhecido e não expõe erros internos ou de transporte', async () => {
  const {EditorialRequestError,accountVerificationFailureMessage}=await import('../dist/admin/editorialUi.js');
  assert.equal(accountVerificationFailureMessage(new EditorialRequestError(400,'Prepare o sistema.')),'Prepare o sistema.');
  for(const error of [new EditorialRequestError(500,'PRIVATE STACK SDK_PATH'),new Error('PRIVATE STACK'),new TypeError('PRIVATE TRANSPORT')]){
    assert.equal(accountVerificationFailureMessage(error),'Não foi possível verificar a conta agora. Consulte o Diagnóstico.');
  }
});
