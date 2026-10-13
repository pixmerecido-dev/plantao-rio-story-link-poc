import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SettingsRepository } from "../admin/repositories.js";
import type { ProcessSupervisor } from "./processSupervisor.js";
import type { RuntimeStore } from "./runtimeStore.js";
import { findAndroidSdk } from "./androidSdk.js";
import type { TestPort } from "./runtimeManager.js";
import { validateStoryJobInput } from "../config/prepareStoryJob.js";
import { assertExecutableStoryMedia } from "../media/StoryMedia.js";
import type { OperationsRepository } from "../admin/operationsStorage.js";
import { randomUUID } from "node:crypto";
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
  ) => {
    const settings = await repository.getSettings();
    const media = resolve(root, "assets/story-preview-demo.jpg"),
      url = "https://plantaorio.com.br/";
    if (action === "prepare") {
      const job = await validateStoryJobInput({
        job_id: id,
        media,
        story_url: url,
        sticker_text: settings.story.sticker.text,
      });
      assertExecutableStoryMedia(job.media);
      if (!settings.story.sticker.enabled)
        throw Error("Ative o link na configuração antes do teste.");
    }
    await mkdir(directory, { recursive: true });
    const request = join(directory, "test-request.json");
    await writeFile(
      request,
      JSON.stringify({
        id,
        directory,
        media,
        url,
        settings,
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
    await host.wait("worker");
    if (action === "prepare") {
      const result = JSON.parse(
        await readFile(join(directory, "test-result.json"), "utf8"),
      );
      if (
        result.job_id !== id ||
        result.published !== false ||
        result.layout_confirmed !== true
      )
        throw Error("Resultado do teste não comprovado.");
      return result;
    }
  };
  return {
    prepare: (id, directory) => launch("prepare", id, directory),
    end: async () => {
      const id = `end-test-${randomUUID()}`;
      await launch("end", id, join(root, "artifacts", id));
    },
  };
}
