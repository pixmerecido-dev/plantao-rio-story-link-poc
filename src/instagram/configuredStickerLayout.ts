/** Future adapter contract. No Appium connection, publication or new gesture implementation here. */
export interface StickerBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface ConfiguredStickerJob {
  job_id: string;
  story_url: string;
  sticker_text: string;
  sticker_style_index: 0 | 1 | 2 | 3;
  sticker_scale: number;
  sticker_x_pct: number;
  sticker_y_pct: number;
  max_text_length: number | null;
}
export interface LiveConfiguredSticker {
  job_id: string;
  displayed: boolean;
  bounds: StickerBounds;
  canvas: StickerBounds;
}
export interface ConfiguredStickerLayoutPort {
  /** Must delegate to the existing same-process transaction guard, including exact URL/text and fresh creation. */
  assertOwnsFreshLink(job: ConfiguredStickerJob): Promise<boolean>;
  /** Must reacquire unique live canvas sticker and hierarchy, never return cached geometry. */
  readSticker(jobId: string): Promise<LiveConfiguredSticker>;
  /** One short tap on the fresh center; implementation will use existing native/W3C infrastructure. */
  tapStyle(jobId: string, center: { x: number; y: number }): Promise<void>;
  /** Delegate to the validated native pinch implementation; do not introduce a replacement strategy. */
  resizeNative(
    jobId: string,
    scale: number,
    bounds: StickerBounds,
  ): Promise<void>;
  /** Delegate to the validated touch-down/hold/stepped W3C movement. */
  moveW3C(
    jobId: string,
    target: { x: number; y: number },
    bounds: StickerBounds,
  ): Promise<void>;
  recordEvent(
    jobId: string,
    event: string,
    metadata: Record<string, unknown>,
  ): Promise<void>;
}
export interface ConfiguredLayoutDiagnostic {
  text: string;
  style_index: 0 | 1 | 2 | 3;
  requested_scale: number;
  bounds_before_resize: StickerBounds;
  bounds_after_resize: StickerBounds;
  bounds_final: StickerBounds;
  center_final: { x: number; y: number };
  target_center: { x: number; y: number };
  position_delta: { x: number; y: number };
  within_tolerance: boolean;
  layout_confirmed: boolean;
  style_verified_visually: false;
}
const width = (b: StickerBounds) => b.right - b.left,
  height = (b: StickerBounds) => b.bottom - b.top;
export const stickerBoundsCenter = (b: StickerBounds) => ({
  x: (b.left + b.right) / 2,
  y: (b.top + b.bottom) / 2,
});
function validateBounds(b: StickerBounds) {
  if (
    !b ||
    ![b.left, b.top, b.right, b.bottom].every(Number.isFinite) ||
    width(b) <= 0 ||
    height(b) <= 0
  )
    throw Error("Bounds vivos inválidos.");
}
/** Per-execution geometry cache: changing text/style invalidates all earlier coordinates. */
export class StickerBoundsSession {
  private current: LiveConfiguredSticker | null = null;
  constructor(readonly jobId: string) {}
  invalidate(_change: "text" | "style" | "resize" | "position") {
    this.current = null;
  }
  accept(live: LiveConfiguredSticker) {
    validateBounds(live.bounds);
    validateBounds(live.canvas);
    if (
      live.job_id !== this.jobId ||
      !live.displayed ||
      live.bounds.left < live.canvas.left ||
      live.bounds.top < live.canvas.top ||
      live.bounds.right > live.canvas.right ||
      live.bounds.bottom > live.canvas.bottom
    )
      throw Error("Sticker não pertence ao canvas/job ativo.");
    this.current = structuredClone(live);
    return this.read();
  }
  read() {
    if (!this.current)
      throw Error("Bounds invalidados; releia a hierarquia antes do gesto.");
    return structuredClone(this.current);
  }
}
export function configuredCenterTarget(
  canvas: StickerBounds,
  sticker: StickerBounds,
  xPct: number,
  yPct: number,
) {
  validateBounds(canvas);
  validateBounds(sticker);
  if (
    ![xPct, yPct].every((v) => Number.isFinite(v) && v >= 0 && v <= 1) ||
    width(sticker) > width(canvas) ||
    height(sticker) > height(canvas)
  )
    throw Error("Centro/canvas inválido.");
  const requested = {
    x: canvas.left + width(canvas) * xPct,
    y: canvas.top + height(canvas) * yPct,
  };
  return {
    requested,
    safe: {
      x: Math.max(
        canvas.left + width(sticker) / 2,
        Math.min(canvas.right - width(sticker) / 2, requested.x),
      ),
      y: Math.max(
        canvas.top + height(sticker) / 2,
        Math.min(canvas.bottom - height(sticker) / 2, requested.y),
      ),
    },
  };
}
/** Runs only once an adapter is wired explicitly. Always stops at layout validation, never publishes. */
export async function prepareConfiguredStickerLayout(
  job: ConfiguredStickerJob,
  port: ConfiguredStickerLayoutPort,
): Promise<ConfiguredLayoutDiagnostic> {
  if (
    !job.job_id ||
    !job.story_url ||
    ![job.sticker_x_pct, job.sticker_y_pct].every(
      (v) => Number.isFinite(v) && v >= 0 && v <= 1,
    ) ||
    !Number.isInteger(job.sticker_style_index) ||
    job.sticker_style_index < 0 ||
    job.sticker_style_index > 3 ||
    !Number.isFinite(job.sticker_scale) ||
    job.sticker_scale < 0.25 ||
    job.sticker_scale > 1.25 ||
    !job.sticker_text.trim() ||
    (job.max_text_length !== null &&
      (!Number.isSafeInteger(job.max_text_length) ||
        job.max_text_length < 1 ||
        Array.from(job.sticker_text).length > job.max_text_length))
  )
    throw Error("Configuração do sticker inválida; texto preservado.");
  if (!(await port.assertOwnsFreshLink(job)))
    throw Error("Link novo e transação do job atual não confirmados.");
  const state = new StickerBoundsSession(job.job_id);
  state.invalidate("text");
  const read = async () => {
    const live = state.accept(await port.readSticker(job.job_id)),
      b = live.bounds,
      c = stickerBoundsCenter(b);
    await port.recordEvent(job.job_id, "STICKER_BOUNDS_READ", {
      text_length: Array.from(job.sticker_text).length,
      style_index: job.sticker_style_index,
      bounds: b,
      width: width(b),
      height: height(b),
      center_x: c.x,
      center_y: c.y,
    });
    return live;
  };
  await port.recordEvent(job.job_id, "STICKER_CREATED", {
    confirmed_current_job: true,
  });
  await port.recordEvent(job.job_id, "STICKER_TEXT_APPLIED", {
    text_length: Array.from(job.sticker_text).length,
    verified: true,
  });
  for (let tap = 0; tap < job.sticker_style_index; tap++) {
    const live = await read();
    if (!(await port.assertOwnsFreshLink(job)))
      throw Error("Transação mudou antes do toque de estilo.");
    const center = stickerBoundsCenter(live.bounds);
    state.invalidate("style");
    await port.tapStyle(job.job_id, center);
    await read();
  }
  await port.recordEvent(job.job_id, "STICKER_STYLE_APPLIED", {
    style_index: job.sticker_style_index,
    taps: job.sticker_style_index,
    visual_verification: false,
  });
  const before = await read(),
    targetWidth = width(before.bounds) * job.sticker_scale,
    targetHeight = height(before.bounds) * job.sticker_scale;
  const sizeOK = (b: StickerBounds) =>
    Math.abs(width(b) - targetWidth) <= targetWidth * 0.08 &&
    Math.abs(height(b) - targetHeight) <= targetHeight * 0.08;
  const resizeRequired = !sizeOK(before.bounds);
  if (resizeRequired) {
    state.invalidate("resize");
    await port.resizeNative(job.job_id, job.sticker_scale, before.bounds);
  }
  const afterResize = await read();
  if (resizeRequired)
    await port.recordEvent(job.job_id, "STICKER_RESIZED", {
      bounds: afterResize.bounds,
      scale: job.sticker_scale,
      within_tolerance: sizeOK(afterResize.bounds),
    });
  const targets = configuredCenterTarget(
    afterResize.canvas,
    afterResize.bounds,
    job.sticker_x_pct,
    job.sticker_y_pct,
  );
  const positionOK = (live: LiveConfiguredSticker) => {
    const c = stickerBoundsCenter(live.bounds);
    return (
      Math.abs(c.x - targets.requested.x) <= width(live.canvas) * 0.04 &&
      Math.abs(c.y - targets.requested.y) <= height(live.canvas) * 0.04
    );
  };
  const moveRequired = sizeOK(afterResize.bounds) && !positionOK(afterResize);
  if (moveRequired) {
    state.invalidate("position");
    await port.moveW3C(job.job_id, targets.safe, afterResize.bounds);
  }
  const final = await read(),
    center = stickerBoundsCenter(final.bounds),
    positionDelta = {
      x: center.x - targets.requested.x,
      y: center.y - targets.requested.y,
    },
    confirmed =
      sizeOK(final.bounds) &&
      positionOK(final) &&
      (await port.assertOwnsFreshLink(job));
  await port.recordEvent(job.job_id, "STICKER_POSITIONED", {
    bounds: final.bounds,
    target_x: targets.requested.x,
    target_y: targets.requested.y,
    delta_x: positionDelta.x,
    delta_y: positionDelta.y,
    moved: moveRequired,
    within_tolerance: positionOK(final),
  });
  if (confirmed)
    await port.recordEvent(job.job_id, "LAYOUT_CONFIRMED", {
      current_job: true,
      layout_confirmed: true,
    });
  return {
    text: job.sticker_text,
    style_index: job.sticker_style_index,
    requested_scale: job.sticker_scale,
    bounds_before_resize: before.bounds,
    bounds_after_resize: afterResize.bounds,
    bounds_final: final.bounds,
    center_final: center,
    target_center: targets.requested,
    position_delta: positionDelta,
    within_tolerance: confirmed,
    layout_confirmed: confirmed,
    style_verified_visually: false,
  };
}
