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
  verifyStyle?(job: ConfiguredStickerJob): Promise<"PASS" | "FAIL" | "UNKNOWN">;
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
  style_transaction_confirmed: boolean;
  size_ok: boolean;
  position_ok: boolean;
  style_result: "PASS" | "FAIL" | "UNKNOWN";
  style_command_sent: boolean;
  resize_command_sent: boolean;
  move_command_sent: boolean;
  style_confirmed: boolean;
  resize_confirmed: boolean;
  position_confirmed: boolean;
  actual_scale: number;
  actual_x_percent: number;
  actual_y_percent: number;
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
  await port.recordEvent(job.job_id, "CONFIG_RECEIVED", {
    style: job.sticker_style_index, scale: job.sticker_scale,
    x: job.sticker_x_pct, y: job.sticker_y_pct, text: job.sticker_text,
  });
  const tapCoordinates: { x: number; y: number }[] = [];
  for (let tap = 0; tap < job.sticker_style_index; tap++) {
    const live = await read();
    if (!(await port.assertOwnsFreshLink(job)))
      throw Error("Transação mudou antes do toque de estilo.");
    const center = stickerBoundsCenter(live.bounds);
    state.invalidate("style");
    await port.tapStyle(job.job_id, center);
    tapCoordinates.push(center);
    await read();
  }
  await port.recordEvent(job.job_id, "STICKER_STYLE_APPLIED", {
    initial_style_index: 0,
    requested_style_index: job.sticker_style_index,
    style_transaction_confirmed: true,
    current_job: true,
    style_index: job.sticker_style_index,
    taps: job.sticker_style_index,
    tap_count_requested: job.sticker_style_index,
    tap_count_executed: tapCoordinates.length, tap_coordinates: tapCoordinates,
    visual_verification: false,
  });
  const assumedInitial = job.sticker_style_index === 0 && tapCoordinates.length === 0;
  const styleResult = assumedInitial ? "PASS" : await port.verifyStyle?.(job) ?? "UNKNOWN";
  await port.recordEvent(job.job_id, "STYLE_ASSUMED_INITIAL", { STYLE_ASSUMED_INITIAL: assumedInitial, visual_verified: false });
  const before = await read(),
    targetWidth = width(before.bounds) * job.sticker_scale,
    targetHeight = height(before.bounds) * job.sticker_scale;
  const sizeOK = (b: StickerBounds) => Math.abs(width(b) - targetWidth) <= targetWidth * 0.03 + 1;
  const resizeRequired = !sizeOK(before.bounds);
  let afterResize = before;
  for (let attempt = 1; !sizeOK(afterResize.bounds) && attempt <= 3; attempt++) {
    const fresh = await read();
    const correction = targetWidth / width(fresh.bounds);
    state.invalidate("resize");
    await port.resizeNative(job.job_id, correction, fresh.bounds);
    afterResize = await read();
    await port.recordEvent(job.job_id, "STICKER_RESIZE_ATTEMPT", {
      attempt, before_bounds: fresh.bounds, before_width: width(fresh.bounds), before_height: height(fresh.bounds),
      target_width: targetWidth, correction_scale: correction,
      after_bounds: afterResize.bounds, after_width: width(afterResize.bounds), after_height: height(afterResize.bounds),
      size_error_percent: (width(afterResize.bounds) - targetWidth) / targetWidth,
      size_ok: sizeOK(afterResize.bounds),
    });
  }
  await port.recordEvent(job.job_id, "STICKER_SIZE_VALIDATED", {
    resize_required: resizeRequired, before_bounds: before.bounds,
    after_bounds: afterResize.bounds, target_width: targetWidth, target_height: targetHeight,
    bounds_rounding_tolerance_px: 1,
    scale_ratio: width(afterResize.bounds) / width(before.bounds), size_ok: sizeOK(afterResize.bounds),
  });
  if (resizeRequired) await port.recordEvent(job.job_id, "STICKER_RESIZED", {
    bounds: afterResize.bounds, scale: job.sticker_scale, within_tolerance: sizeOK(afterResize.bounds),
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
  let latest = afterResize;
  for (let attempt = 1; moveRequired && !positionOK(latest) && attempt <= 2; attempt++) {
    const fresh = await read();
    const freshTargets = configuredCenterTarget(fresh.canvas, fresh.bounds, job.sticker_x_pct, job.sticker_y_pct);
    const beforeCenter = stickerBoundsCenter(fresh.bounds);
    state.invalidate("position");
    await port.moveW3C(job.job_id, freshTargets.safe, fresh.bounds);
    latest = await read();
    const afterCenter = stickerBoundsCenter(latest.bounds);
    await port.recordEvent(job.job_id, "STICKER_MOVE_ATTEMPT", {
      attempt, canvas: fresh.canvas, before_bounds: fresh.bounds, before_center: beforeCenter,
      target_center: freshTargets.requested, safe_target: freshTargets.safe,
      after_bounds: latest.bounds, after_center: afterCenter,
      delta_expected: { x: freshTargets.requested.x - beforeCenter.x, y: freshTargets.requested.y - beforeCenter.y },
      delta_actual: { x: afterCenter.x - beforeCenter.x, y: afterCenter.y - beforeCenter.y },
      position_ok: positionOK(latest),
    });
  }
  const final = await read(),
    center = stickerBoundsCenter(final.bounds),
    positionDelta = {
      x: center.x - targets.requested.x,
      y: center.y - targets.requested.y,
    },
    confirmed =
      styleResult === "PASS" &&
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
  await port.recordEvent(job.job_id, "LAYOUT_RESULT", {
    configured: { style: job.sticker_style_index, scale: job.sticker_scale, x: job.sticker_x_pct, y: job.sticker_y_pct },
    obtained: { style_transaction: true, canvas_bounds: final.canvas,
      actual_scale: width(final.bounds) / width(before.bounds),
      actual_x: (center.x - final.canvas.left) / width(final.canvas),
      actual_y: (center.y - final.canvas.top) / height(final.canvas) },
    position_error_x_percent: positionDelta.x / width(final.canvas),
    position_error_y_percent: positionDelta.y / height(final.canvas),
    style: styleResult, size: sizeOK(final.bounds) ? "PASS" : "FAIL",
    position: positionOK(final) ? "PASS" : "FAIL", layout_confirmed: confirmed,
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
    style_result: styleResult,
    style_command_sent: tapCoordinates.length > 0,
    resize_command_sent: resizeRequired,
    move_command_sent: moveRequired,
    style_confirmed: styleResult === "PASS",
    resize_confirmed: sizeOK(final.bounds),
    position_confirmed: positionOK(final),
    actual_scale: width(final.bounds) / width(before.bounds),
    actual_x_percent: (center.x - final.canvas.left) / width(final.canvas),
    actual_y_percent: (center.y - final.canvas.top) / height(final.canvas),
    style_verified_visually: false,
    style_transaction_confirmed: true,
    size_ok: sizeOK(final.bounds),
    position_ok: positionOK(final),
  };
}
