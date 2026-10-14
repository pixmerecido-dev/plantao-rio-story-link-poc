import { detectInstagramState } from "../instagram/instagramStateMachine.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InstagramDriver } from "../instagram/InstagramDriver.js";
import {
  beginLinkLayoutTransform,
  requireCurrentLinkTransaction,
  inspectAppliedLinkSticker,
} from "../instagram/appliedLinkSticker.js";
import {
  prepareConfiguredStickerLayout,
  type ConfiguredStickerJob,
} from "../instagram/configuredStickerLayout.js";
import { stickerBox } from "../instagram/linkStickerLayout.js";
import { buildSteppedStickerMoveActions } from "../instagram/stickerTouchActions.js";
import { saveScreenArtifacts } from "../instagram/diagnostics.js";
/** Test-only adapter; native resize and validated stepped move retained. No publication dependency. */
export async function applyPanelLayout(
  driver: Pick<InstagramDriver, "getSession">,
  job: ConfiguredStickerJob,
  directory: string,
) {
  const session = driver.getSession();
  const read = async () => {
    await requireCurrentLinkTransaction(session, job.job_id);
    const report = await inspectAppliedLinkSticker(session);
    if (!report.editorActive || report.liveVisualCandidates.length !== 1)
      throw Error("Sticker do teste não confirmado.");
    const c = report.liveVisualCandidates.find(() => true)!;
    return {
      job_id: job.job_id,
      displayed: true,
      bounds: stickerBox(c.bounds),
      canvas: c.canvasBounds,
    };
  };
  const transform = async (work: () => Promise<void>) => {
    const accept = await beginLinkLayoutTransform(session, job.job_id);
    await work();
    await session.pause(1000);
    await accept();
  };
  const result = await prepareConfiguredStickerLayout(job, {
    assertOwnsFreshLink: async () => {
      try {
        await requireCurrentLinkTransaction(session, job.job_id);
        return true;
      } catch {
        return false;
      }
    },
    readSticker: async () => read(),
    tapStyle: async (_id, center) =>
      transform(async () => {
        await session.execute("mobile: clickGesture", {
          x: Math.round(center.x),
          y: Math.round(center.y),
        });
      }),
    resizeNative: async (_id, scale, bounds) => {
      const current = await read();
      if (JSON.stringify(current.bounds) !== JSON.stringify(bounds))
        throw Error("Bounds mudaram antes do resize.");
      if (scale !== 1)
        await transform(async () => {
          // Small native corrections; always measure the effect before the next gesture.
          const percent = Math.min(0.15, Math.max(0.02, Math.abs(1 - scale)));
          console.log(`[RESIZE] native=${scale > 1 ? 'open' : 'close'} percent=${percent} bounds=${JSON.stringify(bounds)}`);
          await session.execute(scale > 1 ? "mobile: pinchOpenGesture" : "mobile: pinchCloseGesture", {
            left: bounds.left, top: bounds.top,
            width: bounds.right - bounds.left, height: bounds.bottom - bounds.top,
            percent,
          });
        });
    },
    moveW3C: async (_id, target, bounds) => {
      const current = await read();
      if (JSON.stringify(current.bounds) !== JSON.stringify(bounds))
        throw Error("Bounds mudaram antes do movimento.");
      await transform(async () => {
        try {
          await session.performActions(
            buildSteppedStickerMoveActions(
              {
                x: (bounds.left + bounds.right) / 2,
                y: (bounds.top + bounds.bottom) / 2,
              },
              target,
            ),
          );
        } finally {
          await session.releaseActions();
        }
      });
    },
    recordEvent: async (_id, event, metadata) => {
      console.log(`[TEST-LAYOUT] ${event} ${JSON.stringify(metadata)}`);
    },
  });
  await saveScreenArtifacts(driver, directory, "test-layout");
  await writeFile(join(directory, "test-layout.json"), JSON.stringify({ job_id: job.job_id, ...result }, null, 2));
  if (!result.layout_confirmed) {
    const failed = [!result.style_confirmed && "estilo", !result.size_ok && "tamanho", !result.position_ok && "posição"].filter(Boolean).join(", ");
    throw Error(`LAYOUT_NOT_CONFIRMED: ${failed || "transação do link"}`);
  }
  if (await detectInstagramState(session) !== 'STATE_EDITOR_WITH_LINK') throw Error('Editor final com Link não confirmado.');
  console.log('[READY] Story preparado com layout aprovado');
  return result;
}
