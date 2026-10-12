import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { InstagramDriver } from './InstagramDriver.js';
import { inspectAppliedLinkSticker } from './appliedLinkSticker.js';
import { TARGET_STICKER_CENTER_X, TARGET_STICKER_CENTER_Y } from '../config/stickerLayout.js';
import { stickerBox } from './linkStickerLayout.js';
import { buildSteppedStickerMoveActions } from './stickerTouchActions.js';
import { saveScreenArtifacts } from './diagnostics.js';
export const FINAL_POSITION_TOLERANCE = 0.04;

/** Diagnóstico isolado: um drag validado, sem pinch, nova tarefa ou autorização de publicação. */
export async function positionCurrentSticker(driver: Pick<InstagramDriver, 'getSession'>, directory: string) {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true.');
  const x = process.env.TARGET_STICKER_CENTER_X === undefined ? TARGET_STICKER_CENTER_X : Number(process.env.TARGET_STICKER_CENTER_X);
  const y = process.env.TARGET_STICKER_CENTER_Y === undefined ? TARGET_STICKER_CENTER_Y : Number(process.env.TARGET_STICKER_CENTER_Y);
  if (![x,y].every(value => Number.isFinite(value) && value > 0 && value < 1)) throw new Error('Centro alvo relativo inválido.');
  const session = driver.getSession();
  const diagnostic: Record<string, unknown> = { position_ok: false, gesture_attempts: 0, resized: false, published: false };
  await mkdir(directory, { recursive: true });
  const read = async () => {
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram fora do primeiro plano.');
    const report = await inspectAppliedLinkSticker(session);
    if (!report.editorActive || report.candidates.length !== 1 || report.liveVisualCandidates.length !== 1) throw new Error('Posicionamento exige um único sticker vivo no canvas atual.');
    for (const candidate of report.liveVisualCandidates) {
      const box = stickerBox(candidate.bounds);
      return { candidate, box, canvas: candidate.canvasBounds, center: { x: (box.left+box.right)/2, y: (box.top+box.bottom)/2 } };
    }
    throw new Error('Sticker ausente.');
  };
  try {
    await saveScreenArtifacts(driver, directory, 'final-position-before');
    const before = await read();
    const cw = before.canvas.right-before.canvas.left, ch = before.canvas.bottom-before.canvas.top;
    const w = before.box.right-before.box.left, h = before.box.bottom-before.box.top;
    const target = { x: before.canvas.left+cw*x, y: before.canvas.top+ch*y };
    const minX = before.canvas.left+w/2+cw*0.002, maxX = before.canvas.right-w/2-cw*0.002;
    const minY = before.canvas.top+h/2+ch*0.002, maxY = before.canvas.bottom-h/2-ch*0.002;
    if (minX > maxX || minY > maxY) throw new Error('Sticker não cabe na área segura sem resize; teste cancelado.');
    const safeTarget = { x: Math.max(minX,Math.min(maxX,target.x)), y: Math.max(minY,Math.min(maxY,target.y)) };
    const positionOK = (center: typeof target) => Math.abs(center.x-target.x) <= cw*FINAL_POSITION_TOLERANCE && Math.abs(center.y-target.y) <= ch*FINAL_POSITION_TOLERANCE;
    if (!positionOK(safeTarget)) throw new Error('Alvo não é atingível na tolerância sem resize; teste cancelado.');
    Object.assign(diagnostic, { before: before.candidate.bounds, center_before: before.center, target_center: target, safe_target_center: safeTarget, canvas: before.canvas, tolerance: FINAL_POSITION_TOLERANCE });
    console.log(`[FINAL-POSITION] before=${before.candidate.bounds}`);
    console.log(`[FINAL-POSITION] center_before=${JSON.stringify(before.center)}`);
    console.log(`[FINAL-POSITION] target_center=${JSON.stringify(target)} safe_target=${JSON.stringify(safeTarget)}`);
    if (!positionOK(before.center)) {
      if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram perdeu foco; drag cancelado.');
      const actions = buildSteppedStickerMoveActions(before.center,safeTarget); // Exatamente o W3C validado.
      diagnostic.gesture_attempts = 1;
      diagnostic.actions = actions;
      await writeFile(join(directory,'final-position.json'),`${JSON.stringify(diagnostic,null,2)}\n`,'utf8');
      try { await session.performActions(actions); }
      finally { await session.releaseActions(); }
      await session.pause(1000);
    } else console.log('[FINAL-POSITION] posição já dentro da tolerância; nenhum gesto necessário');
    await saveScreenArtifacts(driver,directory,'final-position-after');
    const after = await read();
    if (before.candidate.contentDesc !== after.candidate.contentDesc || before.candidate.resourceId !== after.candidate.resourceId || before.candidate.text !== after.candidate.text || before.candidate.class !== after.candidate.class || JSON.stringify(before.canvas) !== JSON.stringify(after.canvas)) throw new Error('Objeto/canvas mudou; posicionamento não comprovado.');
    if (Math.abs(after.box.right-after.box.left-w) > Math.max(2,w*0.01) || Math.abs(after.box.bottom-after.box.top-h) > Math.max(2,h*0.01)) throw new Error('Tamanho mudou durante drag; não corrigir escala neste smoke.');
    const delta = { x: after.center.x-before.center.x,y: after.center.y-before.center.y };
    const ok = positionOK(after.center);
    Object.assign(diagnostic,{ after: after.candidate.bounds,center_after: after.center,delta,position_ok: ok });
    console.log(`[FINAL-POSITION] after=${after.candidate.bounds}`);
    console.log(`[FINAL-POSITION] center_after=${JSON.stringify(after.center)}`);
    console.log(`[FINAL-POSITION] delta=${JSON.stringify(delta)}`);
    console.log(`[FINAL-POSITION] position_ok=${ok}`);
    if (!ok) throw new Error('Posição fora da tolerância de 4%; parar sem outra estratégia.');
    console.log('[OK] Posição final confirmada; sem resize ou publicação');
    return { position_ok: ok,published: false,resized: false };
  } catch (error) {
    diagnostic.error = String(error);
    console.log('[FINAL-POSITION] position_ok=false');
    try { await saveScreenArtifacts(driver,directory,'final-position-error'); } catch (captureError) { diagnostic.capture_error = String(captureError); }
    throw error;
  } finally { await writeFile(join(directory,'final-position.json'),`${JSON.stringify(diagnostic,null,2)}\n`,'utf8'); }
}
