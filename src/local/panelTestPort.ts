import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SettingsRepository } from "../admin/repositories.js";
import type { ProcessSupervisor } from "./processSupervisor.js";
import { runtimeEvent, type RuntimeStore } from "./runtimeStore.js";
import { findAndroidSdk } from "./androidSdk.js";
import type { TestPort } from "./runtimeManager.js";
import {validatePanelContentJob,validatePanelTestResult,panelContentMode} from "./panelContentMode.js";
import { assertExecutableStoryMedia } from "../media/StoryMedia.js";
import {DEFAULT_ACCOUNT_ID} from "../admin/operationsDomain.js";
import type { OperationsRepository } from "../admin/operationsStorage.js";
import { createHash, randomUUID } from "node:crypto";
export function panelTestPort(
  host: ProcessSupervisor,
  store: RuntimeStore,
  repository: SettingsRepository,
  root: string,
  operations: OperationsRepository,
): TestPort {
  const launch = async (
    action: "prepare" | "end",
    id: string,
    directory: string,
    mode: "layout" | "move" = "layout",
  ) => {
    const settings = structuredClone((await operations.read()).account_settings[DEFAULT_ACCOUNT_ID] ?? await repository.getSettings());
    const sticker = settings.story.sticker;
    const settingsSha = createHash("sha256").update(JSON.stringify(settings)).digest("hex");
    await store.change(s => { runtimeEvent(s, "Configuração salva carregada para o teste.", `PANEL_CONFIG_SAVED ${JSON.stringify({ content_mode:panelContentMode(sticker.enabled), snapshot_sha256: settingsSha, style: sticker.style_index, scale: sticker.scale, x: sticker.x_pct, y: sticker.y_pct, text: sticker.text, updated_at: null, loaded_at: new Date().toISOString(), saved_scale: sticker.scale, loaded_scale: sticker.scale, saved_x: sticker.x_pct, loaded_x: sticker.x_pct, saved_y: sticker.y_pct, loaded_y: sticker.y_pct })}`); });
    const media = resolve(root, "assets/story-preview-demo.jpg"),
      url = "https://plantaorio.com.br/";
    if (action === "prepare") {
      const job = await validatePanelContentJob({
        job_id: id,
        media,
        story_url: url,
        sticker_text: settings.story.sticker.text,
      },sticker.enabled);
      assertExecutableStoryMedia(job.media);

    }
    if(mode==='move'&&!sticker.enabled)throw Error("Ative o link para testar movimento; somente imagem não usa gestos de sticker.");
    if (mode === "move" && settings.story.sticker.style_index !== 0) throw Error("Teste isolado exige estilo Azul (estado inicial). Salve estilo 0 antes do teste.");
    await mkdir(directory, { recursive: true });
    const request = join(directory, "test-request.json");
    await writeFile(
      request,
      JSON.stringify({
        id,
        mode,
        content_mode:panelContentMode(sticker.enabled),
        directory,
        media,
        url,
        settings,
        settings_sha256: settingsSha,
        operations: await operations.read(),
      }),
      { mode: 0o600 },
    );
    const state = await store.read(),
      paths = await findAndroidSdk(root, state.config.sdk_path);
    await host.start(
      "worker",
      process.execPath,
      [join(root, "dist/local/testWorker.js"), action, request],
      {
        ...process.env,
        ADMIN_DATA_DIR: resolve(store.filename, ".."),
        ADB_PATH: paths.adb,
        ANDROID_HOME: paths.sdk,
        ANDROID_SDK_ROOT: paths.sdk,
        DRY_RUN: "true",
        ALLOW_PUBLISH: "false",
        CONFIRM_REAL_PUBLISH: "NO",
      },
    );
    try { await host.wait("worker"); }
    catch (error) {
      const failure = await readFile(join(directory, "test-failure.json"), "utf8").then(JSON.parse).catch(() => null);
      if (failure?.job_id === id && failure.published === false && /^LAYOUT_NOT_CONFIRMED: (?:estilo|tamanho|posição|transação do link)(?:, (?:estilo|tamanho|posição))*$/.test(failure.reason)) {
        const layout = await readFile(join(directory, "test-layout.json"), "utf8").then(JSON.parse).catch(() => null);
        throw new Error(failure.reason, { cause: layout?.job_id === id ? { size_ok: layout.size_ok === true, position_ok: layout.position_ok === true } : null });
      }
      throw error;
    }
    if (action === "prepare") {
      const result = JSON.parse(
        await readFile(join(directory, "test-result.json"), "utf8"),
      );
      validatePanelTestResult(result,id,mode,sticker.enabled);
      return result;
    }
  };
  return {
    prepare: (id, directory, mode) => launch("prepare", id, directory, mode),
    end: async () => {
      const id = `end-test-${randomUUID()}`;
      await launch("end", id, join(root, "artifacts", id));
    },
  };
}
