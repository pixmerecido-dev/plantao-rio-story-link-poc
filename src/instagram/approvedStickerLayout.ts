import type { InstagramDriver } from './InstagramDriver.js';
import { inspectAppliedLinkSticker, requireCurrentLinkTransaction } from './appliedLinkSticker.js';
import { stickerBox } from './linkStickerLayout.js';
import { TARGET_STICKER_CENTER_X, TARGET_STICKER_CENTER_Y } from '../config/stickerLayout.js';
import { FINAL_POSITION_TOLERANCE } from './stickerFinalPosition.js';
type Session = ReturnType<InstagramDriver['getSession']>;
// Referência aprovada no emulador: canvas1080x1920, sticker529x88. Não altera percent do pinch.
export const APPROVED_STICKER_WIDTH = 529/1080;
export const APPROVED_STICKER_HEIGHT = 88/1920;
export const APPROVED_SIZE_TOLERANCE = 0.08;
const approvals = new WeakMap<Session,{ jobId: string; fingerprint: string }>();
export function clearApprovedStickerLayout(session: Session): void { approvals.delete(session); }
export async function measureApprovedStickerLayout(session: Session) {
  const report = await inspectAppliedLinkSticker(session);
  if (!report.editorActive || report.candidates.length !== 1 || report.liveVisualCandidates.length !== 1) throw new Error('Layout exige um único sticker vivo no editor.');
  for (const candidate of report.liveVisualCandidates) {
    const box = stickerBox(candidate.bounds), canvas = candidate.canvasBounds;
    const cw = canvas.right-canvas.left, ch = canvas.bottom-canvas.top;
    const expectedWidth = cw*APPROVED_STICKER_WIDTH, expectedHeight = ch*APPROVED_STICKER_HEIGHT;
    const centerX = process.env.TARGET_STICKER_CENTER_X === undefined ? TARGET_STICKER_CENTER_X : Number(process.env.TARGET_STICKER_CENTER_X);
    const centerY = process.env.TARGET_STICKER_CENTER_Y === undefined ? TARGET_STICKER_CENTER_Y : Number(process.env.TARGET_STICKER_CENTER_Y);
    if (![centerX,centerY].every(value => Number.isFinite(value) && value > 0 && value < 1)) throw new Error('Centro alvo inválido.');
    const target = { x: canvas.left+cw*centerX,y: canvas.top+ch*centerY };
    const width = box.right-box.left, height = box.bottom-box.top;
    return { bounds:candidate.bounds,width,height,expectedWidth,expectedHeight,target,
      size_ok: Math.abs(width-expectedWidth) <= expectedWidth*APPROVED_SIZE_TOLERANCE && Math.abs(height-expectedHeight) <= expectedHeight*APPROVED_SIZE_TOLERANCE,
      position_ok: Math.abs((box.left+box.right)/2-target.x) <= cw*FINAL_POSITION_TOLERANCE && Math.abs((box.top+box.bottom)/2-target.y) <= ch*FINAL_POSITION_TOLERANCE,
      fingerprint:JSON.stringify([candidate.resourceId,candidate.contentDesc,candidate.text,candidate.class,candidate.bounds,canvas,target]) };
  }
  throw new Error('Sticker ausente.');
}
export async function confirmApprovedStickerLayout(session: Session,jobId: string) {
  approvals.delete(session);
  await requireCurrentLinkTransaction(session,jobId);
  const measurement = await measureApprovedStickerLayout(session);
  if (!measurement.size_ok || !measurement.position_ok) throw new Error('layout_confirmed=false; tamanho/posição fora do modelo aprovado.');
  approvals.set(session,{ jobId,fingerprint:measurement.fingerprint });
  return { layout_confirmed:true as const,job_id:jobId,...measurement };
}
export async function requireApprovedStickerLayout(session: Session,jobId: string): Promise<void> {
  await requireCurrentLinkTransaction(session,jobId);
  const approval = approvals.get(session);
  if (!approval || approval.jobId !== jobId) throw new Error('Publicação bloqueada: layout_confirmed=false para o job atual.');
  const measurement = await measureApprovedStickerLayout(session);
  if (!measurement.size_ok || !measurement.position_ok || measurement.fingerprint !== approval.fingerprint) {
    approvals.delete(session);
    throw new Error('Publicação bloqueada: layout mudou após confirmação.');
  }
}
