import { join } from 'node:path';
import { mkdir,writeFile } from 'node:fs/promises';
import type { InstagramDriver } from './InstagramDriver.js';
import { beginLinkLayoutTransform,clearCurrentLinkTransaction,requireCurrentLinkTransaction } from './appliedLinkSticker.js';
import { APPROVED_SIZE_TOLERANCE,clearApprovedStickerLayout,confirmApprovedStickerLayout,measureApprovedStickerLayout } from './approvedStickerLayout.js';
import { testCurrentStickerResize } from './stickerResize.js';
import { positionCurrentSticker } from './stickerFinalPosition.js';
import { saveScreenArtifacts } from './diagnostics.js';

/** Reutiliza exatamente os gestos validados, sequencialmente, na transação viva deste job. */
export async function applyApprovedStoryLayout(driver: Pick<InstagramDriver,'getSession'>,jobId: string,directory: string) {
  const session = driver.getSession();
  clearApprovedStickerLayout(session);
  const trace: unknown[] = [];
  await mkdir(directory,{ recursive:true });
  try {
    await requireCurrentLinkTransaction(session,jobId);
    let measurement = await measureApprovedStickerLayout(session);
    trace.push({ stage:'before',...measurement });
    const resizeRequired = !measurement.size_ok;
    console.log(`[LAYOUT] resize_required=${resizeRequired}`);
    if (resizeRequired) {
      if (measurement.width < measurement.expectedWidth*(1-APPROVED_SIZE_TOLERANCE) || measurement.height < measurement.expectedHeight*(1-APPROVED_SIZE_TOLERANCE)) throw new Error('Sticker menor que o aprovado; não criar estratégia de aumento.');
      const acceptGeometry = await beginLinkLayoutTransform(session,jobId);
      await testCurrentStickerResize(driver,join(directory,'resize'));
      await acceptGeometry(); // Reidentifica o mesmo objeto deste job após o pinch validado.
    }
    measurement = await measureApprovedStickerLayout(session);
    console.log(`[LAYOUT] size_ok=${measurement.size_ok}`);
    trace.push({ stage:'after-resize',...measurement });
    if (!measurement.size_ok) throw new Error('Tamanho fora da tolerância aprovada; sem correção adicional.');
    const moveRequired = !measurement.position_ok;
    console.log(`[LAYOUT] move_required=${moveRequired}`);
    if (moveRequired) {
      const acceptGeometry = await beginLinkLayoutTransform(session,jobId);
      await positionCurrentSticker(driver,join(directory,'position'));
      await acceptGeometry();
    }
    measurement = await measureApprovedStickerLayout(session);
    console.log(`[LAYOUT] position_ok=${measurement.position_ok}`);
    trace.push({ stage:'after-position',...measurement });
    const result = await confirmApprovedStickerLayout(session,jobId);
    await saveScreenArtifacts(driver,directory,'layout-approved');
    await writeFile(join(directory,'layout.json'),`${JSON.stringify({ ...result,trace },null,2)}\n`,'utf8');
    console.log('[LAYOUT] confirmed=true');
    console.log('[READY] Story preparado com layout aprovado');
    return result;
  } catch (error) {
    clearApprovedStickerLayout(session);
    clearCurrentLinkTransaction(session);
    console.log('[LAYOUT] confirmed=false');
    try { await saveScreenArtifacts(driver,directory,'layout-error'); } catch { /* preservar causa */ }
    await writeFile(join(directory,'layout.json'),`${JSON.stringify({ job_id:jobId,layout_confirmed:false,trace,error:String(error) },null,2)}\n`,'utf8');
    throw error;
  }
}
