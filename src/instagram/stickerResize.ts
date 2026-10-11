import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { InstagramDriver } from './InstagramDriver.js';
import { inspectAppliedLinkSticker } from './appliedLinkSticker.js';
import { stickerBox } from './linkStickerLayout.js';
import { buildStickerPinchActions } from './stickerTouchActions.js';
import { saveScreenArtifacts } from './diagnostics.js';
export const RESIZE_TEST_TARGET_WIDTH = 490;
export const RESIZE_TEST_MAX_SCALE = 0.7;
export const RESIZE_TEST_MIN_REDUCTION = 0.15;

/** Somente um pinch in sobre o único objeto vivo atual. Sem seleção por tap, move ou publicação. */
export async function testCurrentStickerResize(driver: Pick<InstagramDriver, 'getSession'>, directory: string) {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true.');
  const session = driver.getSession();
  const diagnostic: Record<string, unknown> = { resized: false, gesture_attempts: 0, published: false };
  await mkdir(directory, { recursive: true });
  const read = async () => {
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram fora do primeiro plano.');
    const report = await inspectAppliedLinkSticker(session);
    if (!report.editorActive || report.candidates.length !== 1 || report.liveVisualCandidates.length !== 1) throw new Error('Resize exige um único objeto visual vivo no canvas do editor.');
    for (const candidate of report.liveVisualCandidates) return { candidate, box: stickerBox(candidate.bounds), canvas: candidate.canvasBounds };
    throw new Error('Sticker ausente.');
  };
  try {
    await saveScreenArtifacts(driver, directory, 'resize-test-before');
    const before = await read();
    const widthBefore = before.box.right-before.box.left;
    const center = { x: (before.box.left+before.box.right)/2, y: (before.box.top+before.box.bottom)/2 };
    const factor = Math.min(RESIZE_TEST_MAX_SCALE, RESIZE_TEST_TARGET_WIDTH/widthBefore);
    const actions = buildStickerPinchActions(center, widthBefore, factor);
    let finger = 0;
    console.log(`[RESIZE-W3C] before=${before.candidate.bounds}`);
    console.log(`[RESIZE-W3C] width_before=${widthBefore}`);
    console.log(`[RESIZE-W3C] center=${JSON.stringify(center)}`);
    for (const pointer of actions) {
      for (const move of pointer.actions) if (move.type === 'pointerMove') {
        if (move.x <= before.box.left || move.x >= before.box.right || move.y <= before.box.top || move.y >= before.box.bottom) throw new Error('Pointer de resize fora do sticker atual; gesto cancelado.');
        if (move.duration === 0) console.log(`[RESIZE-W3C] finger${++finger}_start=${JSON.stringify({ x: move.x, y: move.y })}`);
      }
    }
    console.log('[RESIZE-W3C] pinch=in');
    Object.assign(diagnostic, { before: before.candidate.bounds, width_before: widthBefore, center, requested_scale: factor, actions });
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram perdeu foco; pinch cancelado.');
    diagnostic.gesture_attempts = 1;
    await writeFile(join(directory, 'resize-test.json'), `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
    try { await session.performActions(actions); }
    finally { await session.releaseActions(); }
    await session.pause(1000);
    await saveScreenArtifacts(driver, directory, 'resize-test-after');
    const after = await read();
    if (before.candidate.contentDesc !== after.candidate.contentDesc || before.candidate.resourceId !== after.candidate.resourceId || before.candidate.text !== after.candidate.text || before.candidate.class !== after.candidate.class || JSON.stringify(before.canvas) !== JSON.stringify(after.canvas)) throw new Error('Objeto/canvas mudou; resize não comprovado.');
    const widthAfter = after.box.right-after.box.left, ratio = widthAfter/widthBefore;
    const resized = ratio <= 1-RESIZE_TEST_MIN_REDUCTION;
    Object.assign(diagnostic, { after: after.candidate.bounds, width_after: widthAfter, scale_ratio: ratio, resized });
    console.log(`[RESIZE-W3C] after=${after.candidate.bounds}`);
    console.log(`[RESIZE-W3C] width_after=${widthAfter}`);
    console.log(`[RESIZE-W3C] scale_ratio=${ratio}`);
    console.log(`[RESIZE-W3C] resized=${resized}`);
    if (!resized) throw new Error('Redução menor que 15%; nenhum outro gesto será tentado.');
    console.log('[OK] Pinch in confirmado; sem posicionamento ou publicação');
    return { resized, scale_ratio: ratio, published: false };
  } catch (error) {
    diagnostic.error = String(error);
    console.log('[RESIZE-W3C] resized=false');
    try { await saveScreenArtifacts(driver, directory, 'resize-test-error'); } catch (captureError) { diagnostic.capture_error = String(captureError); }
    throw error;
  } finally { await writeFile(join(directory, 'resize-test.json'), `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8'); }
}
