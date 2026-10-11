import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { InstagramDriver } from './InstagramDriver.js';
import { inspectAppliedLinkSticker } from './appliedLinkSticker.js';
import { stickerBox } from './linkStickerLayout.js';
import { buildSteppedStickerMoveActions } from './stickerTouchActions.js';
import { saveScreenArtifacts } from './diagnostics.js';
export const MOVE_TEST_DELTA_X = -250;
export const MOVE_TEST_HOLD_MS = 900;
export const MOVE_TEST_MIN_DELTA_X = 120;

/** Um único gesto W3C de contato contínuo; não busca layout, não faz pinch ou publicação. */
export async function testW3CStickerMovement(driver: Pick<InstagramDriver, 'getSession'>, directory: string) {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true.');
  const session = driver.getSession();
  const diagnostic: Record<string, unknown> = { moved: false, gesture_attempts: 0, published: false };
  await mkdir(directory, { recursive: true });
  const read = async () => {
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram fora do primeiro plano.');
    const report = await inspectAppliedLinkSticker(session);
    if (!report.editorActive || report.candidates.length !== 1 || report.liveVisualCandidates.length !== 1) throw new Error('Teste exige um único sticker visual vivo no canvas atual.');
    for (const candidate of report.liveVisualCandidates) {
      const box = stickerBox(candidate.bounds);
      return { candidate, center: { x: (box.left+box.right)/2, y: (box.top+box.bottom)/2 }, canvas: candidate.canvasBounds };
    }
    throw new Error('Sticker não encontrado.');
  };
  try {
    await saveScreenArtifacts(driver, directory, 'move-test-before');
    const before = await read(); // Última hierarchy/dados vivos antes do comando, não usar bounds antigos.
    const start = { x: Math.round(before.center.x), y: Math.round(before.center.y) };
    const safeLeft = Math.ceil(before.canvas.left+(before.canvas.right-before.canvas.left)*0.02);
    const end = { x: Math.max(safeLeft, start.x+MOVE_TEST_DELTA_X), y: start.y };
    Object.assign(diagnostic, { before: before.candidate.bounds, center_before: before.center, start, end, requested_delta: { x: MOVE_TEST_DELTA_X, y: 0 }, hold_ms: MOVE_TEST_HOLD_MS });
    console.log(`[MOVE-W3C] before=${before.candidate.bounds}`);
    console.log(`[MOVE-W3C] start=${JSON.stringify(start)}`);
    console.log(`[MOVE-W3C] hold_ms=${MOVE_TEST_HOLD_MS}`);
    const actions = buildSteppedStickerMoveActions(start, end);
    let step = 0;
    for (const pointer of actions) for (const action of pointer.actions) if (action.type === 'pointerMove' && action.duration === 200) console.log(`[MOVE-W3C] step${++step}=${JSON.stringify(action)}`);
    if (start.x-end.x < MOVE_TEST_MIN_DELTA_X) throw new Error('Área segura não permite deslocamento de teste de pelo menos 120 px.');
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram perdeu foco; gesto cancelado.');
    diagnostic.gesture_attempts = 1;
    diagnostic.actions = actions;
    await writeFile(join(directory, 'move-test.json'), `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
    try { await session.performActions(actions); }
    finally { await session.releaseActions(); } // Em erro, liberar contato sem tentar outro movimento.
    await session.pause(1000);
    await saveScreenArtifacts(driver, directory, 'move-test-after');
    const after = await read();
    if (before.candidate.contentDesc !== after.candidate.contentDesc || before.candidate.resourceId !== after.candidate.resourceId || before.candidate.text !== after.candidate.text || before.candidate.class !== after.candidate.class || JSON.stringify(before.canvas) !== JSON.stringify(after.canvas)) throw new Error('Objeto/canvas mudou; resultado não comprovado.');
    const delta = { x: after.center.x-before.center.x, y: after.center.y-before.center.y };
    const moved = Math.abs(delta.x) >= MOVE_TEST_MIN_DELTA_X;
    Object.assign(diagnostic, { after: after.candidate.bounds, center_after: after.center, actual_delta: delta, moved });
    console.log(`[MOVE-W3C] after=${after.candidate.bounds}`);
    console.log(`[MOVE-W3C] center_after=${JSON.stringify(after.center)}`);
    console.log(`[MOVE-W3C] actual_delta=${JSON.stringify(delta)}`);
    console.log(`[MOVE-W3C] moved=${moved}`);
    if (!moved) throw new Error('Deslocamento horizontal menor que 120 px; nenhuma outra estratégia será tentada.');
    console.log('[OK] Deslocamento físico confirmado; sem resize ou publicação');
    return { moved, actual_delta: delta, published: false };
  } catch (error) {
    diagnostic.error = String(error);
    console.log('[MOVE-W3C] moved=false');
    try { await saveScreenArtifacts(driver, directory, 'move-test-error'); } catch (captureError) { diagnostic.capture_error = String(captureError); }
    throw error;
  } finally { await writeFile(join(directory, 'move-test.json'), `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8'); }
}
