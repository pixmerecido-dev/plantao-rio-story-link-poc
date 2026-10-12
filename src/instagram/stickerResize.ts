import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { InstagramDriver } from './InstagramDriver.js';
import { inspectAppliedLinkSticker } from './appliedLinkSticker.js';
import { stickerBox } from './linkStickerLayout.js';
import { saveScreenArtifacts } from './diagnostics.js';
export const RESIZE_TEST_PERCENTS = [0.50, 0.75] as const;
export const RESIZE_TEST_MIN_REDUCTION = 0.10;

/** Pinch UiAutomator2 por área: segunda tentativa somente se todos os bounds ficarem iguais. */
export async function testCurrentStickerResize(driver: Pick<InstagramDriver, 'getSession'>, directory: string) {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true.');
  const session = driver.getSession();
  const attempts: Record<string, unknown>[] = [];
  const diagnostic: Record<string, unknown> = { resized: false, gesture_attempts: 0, published: false, attempts };
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
    const original = await read();
    const sameObject = (candidate: typeof original) => original.candidate.contentDesc === candidate.candidate.contentDesc && original.candidate.resourceId === candidate.candidate.resourceId && original.candidate.text === candidate.candidate.text && original.candidate.class === candidate.candidate.class && JSON.stringify(original.canvas) === JSON.stringify(candidate.canvas);
    for (const percent of RESIZE_TEST_PERCENTS) {
      const before = await read(); // Sempre bounds vivos, inclusive antes da tentativa 0.75.
      if (!sameObject(before)) throw new Error('Objeto/canvas mudou; pinch cancelado.');
      const widthBefore = before.box.right-before.box.left;
      const area = { left: before.box.left, top: before.box.top, width: widthBefore, height: before.box.bottom-before.box.top };
      console.log(`[RESIZE-NATIVE] before=${before.candidate.bounds}`);
      console.log(`[RESIZE-NATIVE] width_before=${widthBefore}`);
      console.log(`[RESIZE-NATIVE] area=${JSON.stringify(area)}`);
      console.log(`[RESIZE-NATIVE] percent=${percent.toFixed(2)}`);
      if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram perdeu foco; pinch cancelado.');
      const attempt: Record<string, unknown> = { percent, area, before: before.candidate.bounds, width_before: widthBefore };
      attempts.push(attempt);
      diagnostic.gesture_attempts = attempts.length; // Marcar antes do envio; timeout não autoriza retry.
      await writeFile(join(directory, 'resize-test.json'), `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
      await session.execute('mobile: pinchCloseGesture', { ...area, percent });
      await session.pause(1000);
      await saveScreenArtifacts(driver, directory, `resize-test-after-${attempts.length}`);
      await saveScreenArtifacts(driver, directory, 'resize-test-after');
      const after = await read();
      if (!sameObject(after)) throw new Error('Objeto/canvas mudou; resize não comprovado.');
      const widthAfter = after.box.right-after.box.left, ratio = widthAfter/widthBefore;
      const resized = ratio <= 1-RESIZE_TEST_MIN_REDUCTION;
      const unchanged = before.candidate.bounds === after.candidate.bounds;
      Object.assign(attempt, { after: after.candidate.bounds, width_after: widthAfter, scale_ratio: ratio, resized, unchanged });
      Object.assign(diagnostic, { before: before.candidate.bounds, after: after.candidate.bounds, width_before: widthBefore, width_after: widthAfter, scale_ratio: ratio, resized });
      console.log(`[RESIZE-NATIVE] after=${after.candidate.bounds}`);
      console.log(`[RESIZE-NATIVE] width_after=${widthAfter}`);
      console.log(`[RESIZE-NATIVE] scale_ratio=${ratio}`);
      console.log(`[RESIZE-NATIVE] resized=${resized}`);
      if (resized) {
        console.log('[OK] Pinch nativo confirmado; não corrigir tamanho nesta execução');
        return { resized, scale_ratio: ratio, published: false };
      }
      if (!unchanged) throw new Error('Bounds alterados, mas redução menor que 10%; parar sem corrigir.');
      if (percent === 0.50) console.log('[RESIZE-NATIVE] bounds inalterados; única tentativa adicional com percent=0.75');
    }
    throw new Error('Bounds inalterados após percent=0.50 e 0.75; nenhum outro gesto será tentado.');
  } catch (error) {
    diagnostic.error = String(error);
    console.log('[RESIZE-NATIVE] resized=false');
    try { await saveScreenArtifacts(driver, directory, 'resize-test-error'); } catch (captureError) { diagnostic.capture_error = String(captureError); }
    throw error;
  } finally { await writeFile(join(directory, 'resize-test.json'), `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8'); }
}
