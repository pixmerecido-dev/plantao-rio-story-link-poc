// Frações do canvas. Referência inicial: modelo aprovado: acima da faixa de categoria, alinhado à esquerda.
// Pinch preserva proporção: WIDTH/HEIGHT definem caixa de encaixe, não distorção.
export const TARGET_STICKER_CENTER_X = 0.303;
export const TARGET_STICKER_CENTER_Y = 0.593;
export const TARGET_STICKER_WIDTH = 0.45;
export const TARGET_STICKER_HEIGHT = 0.043;
export const STICKER_LAYOUT_TOLERANCE = 0.005;
export type StickerLayout = { centerX: number; centerY: number; width: number; height: number; tolerance: number };
export function stickerLayout(environment: NodeJS.ProcessEnv = process.env): StickerLayout {
  const read = (name: string, fallback: number) => environment[name] === undefined ? fallback : Number(environment[name]);
  const result = {
    centerX: read('TARGET_STICKER_CENTER_X', TARGET_STICKER_CENTER_X),
    centerY: read('TARGET_STICKER_CENTER_Y', TARGET_STICKER_CENTER_Y),
    width: read('TARGET_STICKER_WIDTH', TARGET_STICKER_WIDTH),
    height: read('TARGET_STICKER_HEIGHT', TARGET_STICKER_HEIGHT),
    tolerance: read('STICKER_LAYOUT_TOLERANCE', STICKER_LAYOUT_TOLERANCE),
  };
  if (Object.values(result).some(value => !Number.isFinite(value) || value <= 0 || value >= 1) || result.tolerance > 0.05 ||
    result.centerX - result.width / 2 < 0.02 || result.centerX + result.width / 2 > 0.98 ||
    result.centerY - result.height / 2 < 0.02 || result.centerY + result.height / 2 > 0.98) throw new Error('Layout inválido ou fora da área segura do canvas.');
  return result;
}
