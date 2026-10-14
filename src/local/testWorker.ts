import { createHash } from "node:crypto";
import { isolatedStickerMove } from "./isolatedStickerMove.js";
import "dotenv/config";
import { resolve, join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { InstagramDriver } from "../instagram/InstagramDriver.js";
import { StoryLinkPublisher } from "../instagram/StoryLinkPublisher.js";
import { validateStoryJobInput } from "../config/prepareStoryJob.js";
import { assertExecutableStoryMedia } from "../media/StoryMedia.js";
import { verifyPublicationAccount } from "../instagram/publicationAccountGuard.js";
import { prepareNewStory } from "../instagram/storyPrepare.js";
import { normalizeInstagramToHome } from "../instagram/normalizeInstagramToHome.js";
import { injectMediaAndOpenStory } from "../instagram/openStoryFromHome.js";
import { saveScreenArtifacts } from "../instagram/diagnostics.js";
import { applyPanelLayout } from "./configuredLayoutAdapter.js";
import type { OperationsState } from "../admin/operationsDomain.js";
import type { StorySettings } from "../admin/domain.js";
// Unconditionally safe, even if parent environment contains real-publication opt-ins.
process.env.DRY_RUN = "true";
process.env.ALLOW_PUBLISH = "false";
process.env.CONFIRM_REAL_PUBLISH = "NO";
const [action, requestFile] = process.argv.slice(2);
if (!requestFile || !["prepare", "end"].includes(action ?? ""))
  throw Error("Ação de teste inválida.");
const request = JSON.parse(await readFile(requestFile, "utf8")) as {
  id: string;
  mode?: "layout" | "move";
  directory: string;
  media: string;
  url: string;
  settings: StorySettings;
  settings_sha256: string;
  operations: OperationsState;
};
const directory = resolve(request.directory),
  driver = new InstagramDriver();
let connected = false;
try {
  await mkdir(directory, { recursive: true });
  if (createHash("sha256").update(JSON.stringify(request.settings)).digest("hex") !== request.settings_sha256) throw Error("Configuração carregada diverge da configuração salva; teste cancelado.");
  const loaded = request.settings.story.sticker;
  console.log("WORKER_CONFIG_LOADED", JSON.stringify({ style: loaded.style_index, scale: loaded.scale, x: loaded.x_pct, y: loaded.y_pct, text: loaded.text, updated_at: null, loaded_at: new Date().toISOString(), snapshot_sha256: request.settings_sha256 }));
  const job =
    action === "prepare"
      ? await validateStoryJobInput({
          job_id: request.id,
          media: request.media,
          story_url: request.url,
          sticker_text: request.settings.story.sticker.text,
          publish_instagram: false,
          publish_facebook: false,
        })
      : null;
  if (job) assertExecutableStoryMedia(job.media);
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  if (action === "end") {
    await normalizeInstagramToHome(driver, directory);
  } else if (job) {
    // Parent backend alone owns persistent operations.json; child verifies against an immutable job snapshot.
    const accountState = structuredClone(request.operations);
    await verifyPublicationAccount(driver, join(directory, "account"), {
      store: {
        read: async () => structuredClone(accountState),
        transact: async (fn) => fn(accountState),
      },
    });
    const publisher = new StoryLinkPublisher(driver),
      s = request.settings.story.sticker;
    if (!s.enabled) throw Error("Ative o link na configuração antes do teste.");
    let confirmedLayout: Awaited<ReturnType<typeof applyPanelLayout>> | undefined;
    const result = await prepareNewStory(
      driver,
      job,
      directory,
      async () => {
        const { filename } = await injectMediaAndOpenStory(
          driver,
          publisher,
          job.media,
          join(directory, "image-flow"),
        );
        await publisher.loadMediaIntoStory(
          job.media,
          join(directory, "image-flow"),
          { requireNewImage: true, expectedFilename: filename },
        );
      },
      async () => {
        if (request.mode === "move") return isolatedStickerMove(driver, job.job_id, directory);
        confirmedLayout = await applyPanelLayout(
          driver,
          {
            job_id: job.job_id,
            story_url: job.story_url,
            sticker_text: job.sticker_text,
            sticker_style_index: s.style_index,
            sticker_scale: s.scale,
            sticker_x_pct: s.x_pct,
            sticker_y_pct: s.y_pct,
            max_text_length: s.max_text_length,
          },
          directory,
        );
        return confirmedLayout;
      },
    );
    if (request.mode === "move") {
      await writeFile(join(directory,"test-result.json"), JSON.stringify({job_id:job.job_id,published:false,layout_confirmed:true,movement_confirmed:true}));
    } else {
    if (!confirmedLayout?.style_confirmed || !confirmedLayout.resize_confirmed || !confirmedLayout.position_confirmed)
      throw Error("LAYOUT_NOT_CONFIRMED: estilo, tamanho, posição");
    await writeFile(
      join(directory, "test-result.json"),
      JSON.stringify({
        job_id: job.job_id,
        published: false,
        layout_confirmed: result.layout_confirmed,
        style_verified_visually: false,
        style_transaction_confirmed: confirmedLayout.style_transaction_confirmed,
        style_confirmed: confirmedLayout.style_confirmed,
        size_ok: confirmedLayout.resize_confirmed, position_ok: confirmedLayout.position_confirmed,
        image_loaded: true, url_verified: result.url_verified,
        sticker_text_verified: result.sticker_text_verified,
        editor_final_confirmed: true,
      }),
    );
  }
  }
  console.log("[SAFE] Nenhuma publicação foi realizada.");
} catch (error) {
  if (connected)
    await saveScreenArtifacts(driver, directory, "error").catch(() => {});
  await writeFile(join(directory, "test-failure.json"), JSON.stringify({
    job_id: request.id, published: false,
    reason: error instanceof Error && /^LAYOUT_NOT_CONFIRMED: (?:estilo|tamanho|posição|transação do link)(?:, (?:estilo|tamanho|posição))*$/.test(error.message) ? error.message : "TEST_FAILED",
  })).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await driver.disconnect().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
