export type TouchPoint = { x: number; y: number };
const pointer = (id: string, from: TouchPoint, to: TouchPoint, holdMs: number, moveMs: number) => ({
  type: 'pointer' as const, id, parameters: { pointerType: 'touch' as const }, actions: [
    { type: 'pointerMove' as const, origin: 'viewport' as const, duration: 0, x: Math.round(from.x), y: Math.round(from.y) },
    { type: 'pointerDown' as const, button: 0 },
    { type: 'pause' as const, duration: holdMs },
    { type: 'pointerMove' as const, origin: 'viewport' as const, duration: moveMs, x: Math.round(to.x), y: Math.round(to.y) },
    { type: 'pointerUp' as const, button: 0 },
  ],
});
export function buildStickerMoveActions(from: TouchPoint, to: TouchPoint) {
  return [pointer('sticker-move', from, to, 650, 900)];
}
/** Apenas plano do futuro smoke resize; não executado pelo smoke move nem preparação. */
export function buildStickerPinchActions(center: TouchPoint, width: number, factor: number) {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(width) || width <= 0) throw new Error('Escala de pinch inválida.');
  const offset = width * Math.min(0.3, 0.3 / factor);
  if (Math.round(offset) < 2 || Math.round(offset * factor) < 2) throw new Error('Pinch sem separação utilizável.');
  return [
    pointer('sticker-pinch-left', { x: center.x - offset, y: center.y }, { x: center.x - offset * factor, y: center.y }, 150, 900),
    pointer('sticker-pinch-right', { x: center.x + offset, y: center.y }, { x: center.x + offset * factor, y: center.y }, 150, 900),
  ];
}

/** Hold explícito + cinco passos, sem pointerUp intermediário. */
export function buildSteppedStickerMoveActions(from: TouchPoint, to: TouchPoint) {
  const steps = Array.from({ length: 5 }, (_, index) => ({
    type: 'pointerMove' as const, origin: 'viewport' as const, duration: 200,
    x: Math.round(from.x+(to.x-from.x)*(index+1)/5),
    y: Math.round(from.y+(to.y-from.y)*(index+1)/5),
  }));
  return [{ type: 'pointer' as const, id: 'sticker-move-stepped', parameters: { pointerType: 'touch' as const }, actions: [
    { type: 'pointerMove' as const, origin: 'viewport' as const, duration: 0, x: Math.round(from.x), y: Math.round(from.y) },
    { type: 'pointerDown' as const, button: 0 },
    { type: 'pause' as const, duration: 900 },
    ...steps,
    { type: 'pause' as const, duration: 150 },
    { type: 'pointerUp' as const, button: 0 },
  ] }];
}
