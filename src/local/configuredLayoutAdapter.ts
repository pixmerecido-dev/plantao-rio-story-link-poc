import { detectInstagramState } from "../instagram/instagramStateMachine.js";
import { writeFile } from "node:fs/promises";
import { join,resolve } from "node:path";
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
import {resizePanelMirror} from './panelMirrorResize.js';
import {testEmulatorMirrorPinch,emulatorMirrorActions} from '../gestureLab/emulatorMirrorPinch.js';
import {connectedAndroidDevice} from '../instagram/addStoryAndroidDiagnostics.js';
import {startTouchLog} from '../gestureLab/touchLogCapture.js';
import {analyzeTouchInjectionLog} from '../gestureLab/touchInjectionLog.js';
import {ObservedSizeLimitStore} from '../gestureLab/sizeLimitStore.js';
import {findObservedLimit} from '../admin/stickerSizeLimit.js';
/** Test-only adapter: measured mirror resize and frozen stepped move. No publication dependency. */
export async function applyPanelLayout(
  driver: Pick<InstagramDriver, "getSession">,
  job: ConfiguredStickerJob,
  directory: string,
) {
  if(job.sticker_style_index!==0||!['Veja','Leia a matéria completa','veja a materia complata no jornal'].includes(job.sticker_text))throw Error('Teste de layout validado somente para os três textos calibrados no estilo branco/azul.');
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
    resizeNative: async () => {throw Error('Fallback nativo desativado neste teste.');},
    resizeMeasured: async (_id,requested,bounds) => {
      const initial=await read();
      if(JSON.stringify(initial.bounds)!==JSON.stringify(bounds))throw Error('Bounds mudaram antes do resize.');
      const device=connectedAndroidDevice(session),viewport=await session.getWindowRect();
      if(device!=='emulator-5554'||viewport.x!==0||viewport.y!==0||viewport.width!==1080||viewport.height!==2400||initial.canvas.right-initial.canvas.left!==1080||initial.canvas.bottom-initial.canvas.top!==1920)throw Error('Configuração fora do ambiente validado para resize.');
      const snapshot=async()=>{const live=await read();return {bounds:live.bounds,canvas:live.canvas,identity:job.job_id,device};};
      const scope={text:job.sticker_text,style_index:job.sticker_style_index,canvas_width:1080,canvas_height:1920,device,instagram_version:process.env.GESTURE_INSTAGRAM_VERSION??null};
      const limits=await new ObservedSizeLimitStore(resolve(process.env.ADMIN_DATA_DIR??'data/admin','sticker-size-limits.json')).load();
      const known=findObservedLimit(limits,scope);
      // Never import a previous Story's session-only minimum (including 575).
      const result=await resizePanelMirror(snapshot,async(direction,attempt,expected)=>{
        const log=await startTouchLog(device);let evidence;
        try{
          const trial=await testEmulatorMirrorPinch({read:snapshot,
            capture:async name=>{await saveScreenArtifacts(driver,directory,`panel-resize-${attempt}-${name}`);},
            record:async value=>{console.log('[PANEL-RESIZE]',JSON.stringify(value));},
            pinch:async(plan,before)=>{
              if(JSON.stringify(before)!==JSON.stringify(expected)||JSON.stringify(await snapshot())!==JSON.stringify(before))throw Error('Objeto mudou antes do toque.');
              if(JSON.stringify(await session.getWindowRect())!==JSON.stringify(viewport))throw Error('Viewport mudou antes do toque.');
              await transform(async()=>{try{await session.performActions(emulatorMirrorActions(plan));}finally{await session.releaseActions();}});
            }},viewport,direction);
          const captured=await log.stop();await writeFile(join(directory,`panel-resize-${attempt}-touch-injection-logcat.txt`),captured.text);
          evidence=analyzeTouchInjectionLog(captured.text);
          return {...trial,success:trial.measured_resize_success&&evidence.injection_sequence_observed&&!captured.truncated,touch_injection:{...evidence,truncated:captured.truncated}};
        }catch(error){await log.stop().catch(()=>{});throw error;}
      },requested,known?.observed_min_width);
      await writeFile(join(directory,'panel-resize-report.json'),JSON.stringify({...result,scope,minimum_source:known?'CONFIGURATION_REGISTRY':'UNKNOWN',session_minimum_reused:false},null,2));
      return result;
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
