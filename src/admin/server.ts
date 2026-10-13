import { RuntimeStore } from "../local/runtimeStore.js";
import { RuntimeManager } from "../local/runtimeManager.js";
import { ProcessSupervisor } from "../local/processSupervisor.js";
import { panelTestPort } from "../local/panelTestPort.js";
import { localAccountDetector } from "../instagram/accountVerification.js";
import { FeedPollingService } from "../ingestion/feedPollingService.js";
import "dotenv/config";
import { resolve } from "node:path";
import { JsonStorage } from "./jsonStorage.js";
import { OperationsStorage } from "./operationsStorage.js";
import { DEFAULT_ACCOUNT_ID } from "./operationsDomain.js";
import { PublicationQueueService } from "./operationalServices.js";
import { createOperationsApi } from "./operationsHttp.js";
import { mkdir, open, readFile, unlink, access } from "node:fs/promises";
import { createAdminServer } from "./httpServer.js";
const port = Number(process.env.ADMIN_PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("ADMIN_PORT deve estar entre 1024 e 65535.");
const root = process.cwd(),
  data = resolve(process.env.ADMIN_DATA_DIR ?? "data/admin");
// Prevent a second backend from recovering or writing jobs owned by a live process.
await mkdir(data, { recursive: true });
const lockPath = resolve(data, "backend.lock");
async function acquire() {
  try {
    return await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(await readFile(lockPath, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0)
      throw Error("Lock inválido; revise backend.lock manualmente.");
    try {
      process.kill(pid, 0);
      throw Error("Outro backend já utiliza este armazenamento.");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
    }
    await unlink(lockPath);
    return open(lockPath, "wx", 0o600);
  }
}
const lock = await acquire();
await lock.writeFile(String(process.pid));
await lock.close();
const repository = new JsonStorage(resolve(data, "admin.json"));
const initialSettings = await repository.getSettings();
const operationsFilename = resolve(data, "operations.json");
const existed = await access(operationsFilename).then(
  () => true,
  () => false,
);
const operationsStore = new OperationsStorage(operationsFilename);
if (!existed)
  await operationsStore.transact((s) => {
    s.account_settings[DEFAULT_ACCOUNT_ID] = initialSettings;
  });
await new PublicationQueueService(operationsStore).recoverAfterCrash();
const operationalApi = createOperationsApi(
  operationsStore,
  process.env.STORY_MEDIA ??
    process.env.STORY_IMAGE ??
    resolve(root, "assets/story-test.jpg"),
);
const schedulerTimer = setInterval(
  () =>
    void operationalApi
      .tick()
      .catch((error) => console.error("[SCHEDULER]", error.message)),
  10000,
);
schedulerTimer.unref();
const feedService = new FeedPollingService(
  operationsStore,
  resolve(root, "data/media"),
);
await feedService.recover();
const runtimeStore = new RuntimeStore(resolve(data, "runtime.json"));
const supervisor = new ProcessSupervisor(runtimeStore, root);
const runtime = new RuntimeManager(
  runtimeStore,
  operationsStore,
  supervisor,
  root,
  localAccountDetector(),
  panelTestPort(supervisor, runtimeStore, repository, root, operationsStore),
);
await runtime.recover();
const runtimeMonitor = setInterval(() => {
  void runtime
    .refresh()
    .catch((error) => console.error("[RUNTIME]", error.message));
}, 15000);
runtimeMonitor.unref();
const server = createAdminServer({
  feedService,
  runtime,
  accountDetector: (selector) => runtime.detectAccount(selector),
  repository,
  root,
  operationsStore,
  testMedia: process.env.STORY_MEDIA?.trim()
    ? process.env.STORY_MEDIA
    : process.env.STORY_IMAGE?.trim()
      ? process.env.STORY_IMAGE
      : undefined,
  previewPath: process.env.ADMIN_PREVIEW_IMAGE?.trim() || undefined,
});
server.on("error", (error) => {
  console.error("[ADMIN] Não foi possível iniciar:", error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Admin: http://127.0.0.1:${port}`);
  console.log("Painel local em Modo Teste; publicação permanece desabilitada.");
  console.log(`Persistência: ${data}`);
  feedService.start();
});
let shuttingDown = false;
function closeApplication() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    clearInterval(schedulerTimer);
    clearInterval(runtimeMonitor);
    void feedService
      .stop()
      .then(() => runtime.shutdown())
      .then(() => supervisor.shutdown())
      .then(() => unlink(lockPath))
      .finally(() => process.exit(0));
  });
}
runtime.onCloseApplication(closeApplication);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, closeApplication);
