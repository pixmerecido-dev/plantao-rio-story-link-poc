import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { InstagramDriver } from './InstagramDriver.js';
import { inspectAppliedLinkSticker } from './appliedLinkSticker.js';
import { stickerLayout } from '../config/stickerLayout.js';
import { stickerBox } from './linkStickerLayout.js';
import { buildStickerMoveActions } from './stickerTouchActions.js';
import { saveScreenArtifacts } from './diagnostics.js';

export const STICKER_POSITION_TOLERANCE = 0.04;
export const STICKER_SIZE_TOLERANCE = 0.08;
export async function moveCurrentCanvasSticker(driver: Pick<InstagramDriver, 'getSession'>, directory: string) {
  if (process.env.DRY_RUN !== 'true') throw new Error('Diagnóstico exige DRY_RUN=true.');
  const config = stickerLayout();
  const tolerance = process.env.STICKER_POSITION_TOLERANCE === undefined ? STICKER_POSITION_TOLERANCE : Number(process.env.STICKER_POSITION_TOLERANCE);
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 0.08) throw new Error('Tolerância de posição inválida.');
  const session = driver.getSession();
  const history: unknown[] = [];
  let confirmed = false, failure: string | undefined;
  const read = async () => {
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram fora do primeiro plano.');
    const report = await inspectAppliedLinkSticker(session);
    if (!report.editorActive || report.candidates.length !== 1 || report.liveVisualCandidates.length !== 1) throw new Error('Smoke exige exatamente um objeto visual de sticker vivo no canvas atual.');
    for (const candidate of report.liveVisualCandidates) return { candidate, box: stickerBox(candidate.bounds), canvas: candidate.canvasBounds };
    throw new Error('Sticker ausente.');
  };
  await mkdir(directory, { recursive: true });
  try {
    await saveScreenArtifacts(driver, directory, 'sticker-move-before');
    const initial = await read();
    // Autorização somente para diagnóstico do único objeto visual atual, não para publicar.
    console.log('[LAYOUT-MOVE] diagnóstico visual isolado; não cria nem restaura confirmação de transação Link');
    const target = { x: initial.canvas.left + (initial.canvas.right-initial.canvas.left)*config.centerX,
      y: initial.canvas.top + (initial.canvas.bottom-initial.canvas.top)*config.centerY };
    const cw = initial.canvas.right-initial.canvas.left, ch = initial.canvas.bottom-initial.canvas.top;
    const positionOK = (box: typeof initial.box) => Math.abs((box.left+box.right)/2-target.x) <= cw*tolerance && Math.abs((box.top+box.bottom)/2-target.y) <= ch*tolerance;
    for (let attempt = 1; attempt <= 2; attempt++) {
      // A última leitura antes de cada gesto resolve novamente o objeto vivo, sem handle/bounds antigos.
      const before = await read();
      if (before.candidate.contentDesc !== initial.candidate.contentDesc || before.candidate.resourceId !== initial.candidate.resourceId || before.candidate.text !== initial.candidate.text || before.candidate.class !== initial.candidate.class || JSON.stringify(before.canvas) !== JSON.stringify(initial.canvas)) throw new Error('Objeto/canvas mudou; movimento cancelado.');
      console.log(`[LAYOUT-MOVE] before=${before.candidate.bounds}`);
      if (positionOK(before.box)) { confirmed = true; console.log('[LAYOUT-MOVE] position_ok=true; nenhuma alteração necessária'); break; }
      const center = { x: (before.box.left+before.box.right)/2, y: (before.box.top+before.box.bottom)/2 };
      const width = before.box.right-before.box.left, height = before.box.bottom-before.box.top;
      const safeTarget = { x: Math.max(before.canvas.left+width/2+cw*0.002, Math.min(before.canvas.right-width/2-cw*0.002, target.x)),
        y: Math.max(before.canvas.top+height/2+ch*0.002, Math.min(before.canvas.bottom-height/2-ch*0.002, target.y)) };
      if (Math.abs(safeTarget.x-target.x) > cw*tolerance || Math.abs(safeTarget.y-target.y) > ch*tolerance) throw new Error('Sticker grande demais para atingir alvo sem sair do canvas; não redimensionar no smoke move.');
      console.log(`[LAYOUT-MOVE] center=${JSON.stringify(center)}`);
      console.log(`[LAYOUT-MOVE] target=${JSON.stringify(target)} safe_target=${JSON.stringify(safeTarget)}`);
      console.log('[LAYOUT-MOVE] long-press started');
      try { await session.performActions(buildStickerMoveActions(center, safeTarget)); }
      finally { await session.releaseActions(); }
      console.log('[LAYOUT-MOVE] drag completed');
      await session.pause(1000);
      await saveScreenArtifacts(driver, directory, `sticker-move-after-${attempt}`);
      const after = await read();
      if (after.candidate.contentDesc !== initial.candidate.contentDesc || after.candidate.text !== initial.candidate.text || after.candidate.resourceId !== initial.candidate.resourceId || after.candidate.class !== initial.candidate.class || JSON.stringify(after.canvas) !== JSON.stringify(initial.canvas)) throw new Error('Identidade visual perdida após movimento.');
      const ok = positionOK(after.box);
      const changed = Math.hypot((after.box.left+after.box.right-before.box.left-before.box.right)/2, (after.box.top+after.box.bottom-before.box.top-before.box.bottom)/2) > Math.min(cw, ch)*0.002;
      console.log(`[LAYOUT-MOVE] after=${after.candidate.bounds}`);
      console.log(`[LAYOUT-MOVE] position_ok=${ok}`);
      history.push({ attempt, before: before.candidate.bounds, after: after.candidate.bounds, target, safeTarget, changed, position_ok: ok });
      if (ok) { confirmed = true; break; }
      if (!changed) throw new Error('Bounds sem mudança significativa; movimento abortado sem repetir gesto ineficaz.');
    }
    if (!confirmed) throw new Error('Posição não confirmada após duas tentativas.');
    await saveScreenArtifacts(driver, directory, 'sticker-move-final');
    console.log('[OK] Sticker move confirmed; publicação não executada');
    return { position_ok: true, published: false };
  } catch (error) {
    failure = String(error);
    try { await saveScreenArtifacts(driver, directory, 'sticker-move-error'); } catch { /* preservar erro original */ }
    throw error;
  } finally {
    await writeFile(join(directory, 'sticker-move.json'), `${JSON.stringify({ position_ok: confirmed, publication_authorized: false, history, failure }, null, 2)}\n`, 'utf8');
  }
}
