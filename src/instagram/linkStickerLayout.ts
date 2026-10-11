import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { InstagramDriver } from './InstagramDriver.js';
import { beginLinkLayoutTransform, clearCurrentLinkTransaction, inspectAppliedLinkSticker, requireCurrentLinkTransaction } from './appliedLinkSticker.js';
import { stickerLayout, type StickerLayout } from '../config/stickerLayout.js';
import { saveScreenArtifacts } from './diagnostics.js';
type Box = { left: number; top: number; right: number; bottom: number };
export function stickerBox(bounds: string): Box {
  const values = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(bounds);
  if (!values) throw new Error('Bounds inválidos.');
  const [, l, t, r, b] = values;
  const box = { left: Number(l), top: Number(t), right: Number(r), bottom: Number(b) };
  if (box.right <= box.left || box.bottom <= box.top) throw new Error('Sticker sem área válida.');
  return box;
}
const width = (b: Box) => b.right - b.left;
const height = (b: Box) => b.bottom - b.top;
const center = (b: Box) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
export function layoutTarget(canvas: Box, sticker: Box, config: StickerLayout): Box {
  const scale = Math.min(width(canvas) * config.width / width(sticker), height(canvas) * config.height / height(sticker));
  const x = canvas.left + width(canvas) * config.centerX, y = canvas.top + height(canvas) * config.centerY;
  return { left: x - width(sticker) * scale / 2, right: x + width(sticker) * scale / 2, top: y - height(sticker) * scale / 2, bottom: y + height(sticker) * scale / 2 };
}
export function matchesStickerLayout(actual: Box, target: Box, canvas: Box, tolerance: number): boolean {
  const a = center(actual), t = center(target);
  return Math.abs(a.x - t.x) <= width(canvas) * tolerance && Math.abs(a.y - t.y) <= height(canvas) * tolerance &&
    Math.abs(width(actual) - width(target)) <= width(canvas) * tolerance && Math.abs(height(actual) - height(target)) <= height(canvas) * tolerance;
}

/** Gestos somente sobre o Link único confirmado do job atual; no máximo dois ajustes. */
export async function adjustLinkStickerLayout(driver: Pick<InstagramDriver, 'getSession'>, jobId: string, directory: string, config = stickerLayout()) {
  const session = driver.getSession();
  const logs: unknown[] = [];
  let beforeBounds: string | undefined, finalBounds: string | undefined, targetBox: Box | undefined, canvasSignature: string | undefined;
  const read = async () => {
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram fora do primeiro plano.');
    const report = await inspectAppliedLinkSticker(session);
    if (!report.editorActive || report.candidates.length !== 1 || report.liveVisualCandidates.length !== 1) throw new Error('Layout exige sticker único visível no canvas do editor.');
    for (const candidate of report.liveVisualCandidates) {
      if (canvasSignature && JSON.stringify(candidate.canvasBounds) !== canvasSignature) throw new Error('Canvas mudou durante layout; ajuste cancelado.');
      return { candidate, box: stickerBox(candidate.bounds), canvas: candidate.canvasBounds };
    }
    throw new Error('Sticker ausente.');
  };
  const actions = async (fingers: { from: { x: number; y: number }; to: { x: number; y: number } }[], hold: number) => {
    try {
      await session.performActions(fingers.map((finger, index) => ({ type: 'pointer' as const, id: `link-layout-${index}`, parameters: { pointerType: 'touch' as const }, actions: [
        { type: 'pointerMove' as const, duration: 0, origin: 'viewport' as const, x: Math.round(finger.from.x), y: Math.round(finger.from.y) },
        { type: 'pointerDown' as const, button: 0 }, { type: 'pause' as const, duration: hold },
        { type: 'pointerMove' as const, duration: 650, origin: 'viewport' as const, x: Math.round(finger.to.x), y: Math.round(finger.to.y) },
        { type: 'pointerUp' as const, button: 0 },
      ] })));
    } finally { await session.releaseActions(); }
    await session.pause(600);
  };
  try {
    await requireCurrentLinkTransaction(session, jobId);
    let current = await read();
    const originalCanvas = JSON.stringify(current.canvas);
    canvasSignature = originalCanvas;
    beforeBounds = current.candidate.bounds;
    const target = layoutTarget(current.canvas, current.box, config);
    targetBox = target;
    await saveScreenArtifacts(driver, directory, 'link-layout-before');
    console.log('[LAYOUT] before:', JSON.stringify({ bounds: current.candidate.bounds, canvas: current.canvas, target }));
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (matchesStickerLayout(current.box, target, current.canvas, config.tolerance)) break;
      const factor = Math.min(width(target) / width(current.box), height(target) / height(current.box));
      if (Math.abs(width(current.box) - width(target)) > width(current.canvas) * config.tolerance || Math.abs(height(current.box) - height(target)) > height(current.canvas) * config.tolerance) {
        const acceptScale = await beginLinkLayoutTransform(session, jobId);
        const c = center(current.box);
        // Dois pontos internos do sticker atual, nunca coordenadas hardcoded.
        const offset = width(current.box) * Math.min(0.3, 0.3 / factor);
        await actions([
          { from: { x: c.x - offset, y: c.y }, to: { x: c.x - offset * factor, y: c.y } },
          { from: { x: c.x + offset, y: c.y }, to: { x: c.x + offset * factor, y: c.y } },
        ], 100);
        await acceptScale();
      }
      current = await read();
      const acceptMove = await beginLinkLayoutTransform(session, jobId);
      const c = center(current.box), t = center(target);
      if (Math.abs(c.x - t.x) > width(current.canvas) * config.tolerance || Math.abs(c.y - t.y) > height(current.canvas) * config.tolerance) {
        const fits = t.x - width(current.box)/2 > current.canvas.left && t.x + width(current.box)/2 < current.canvas.right &&
          t.y - height(current.box)/2 > current.canvas.top && t.y + height(current.box)/2 < current.canvas.bottom;
        if (fits) await actions([{ from: c, to: t }], 600);
        else console.log('[LAYOUT] tamanho ainda impede movimento seguro; arraste omitido');
      }
      await acceptMove();
      current = await read();
      if (JSON.stringify(current.canvas) !== originalCanvas) throw new Error('Canvas mudou durante layout; ajuste cancelado.');
      logs.push({ attempt, bounds: current.candidate.bounds, target });
      console.log(`[LAYOUT] tentativa ${attempt} after: ${current.candidate.bounds}`);
      await saveScreenArtifacts(driver, directory, `link-layout-after-${attempt}`);
      if (matchesStickerLayout(current.box, target, current.canvas, config.tolerance)) break;
      console.log('[LAYOUT] alvo não atingido; próxima tentativa somente se ainda disponível');
    }
    if (!matchesStickerLayout(current.box, target, current.canvas, config.tolerance)) throw new Error('Layout não confirmado após dois ajustes; publicação bloqueada.');
    await requireCurrentLinkTransaction(session, jobId);
    await saveScreenArtifacts(driver, directory, 'link-layout-final');
    finalBounds = current.candidate.bounds;
    console.log(`[LAYOUT] final bounds=${finalBounds}`);
    console.log('[LAYOUT] posição e tamanho confirmados');
    return { target, bounds: current.candidate.bounds, config };
  } catch (error) {
    clearCurrentLinkTransaction(session);
    try { await saveScreenArtifacts(driver, directory, 'link-layout-error'); } catch { /* Erro original preservado. */ }
    throw error;
  } finally {
    await writeFile(join(directory, 'link-layout.json'), `${JSON.stringify({ job_id: jobId, config, beforeBounds, finalBounds, target: targetBox, attempts: logs }, null, 2)}\n`, 'utf8');
  }
}
