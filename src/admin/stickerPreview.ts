import { REFERENCE, stickerTextLength } from "./domain.js";
export const PREVIEW_STYLE_LABELS = [
  "Azul",
  "Translúcido",
  "Preto",
  "Colorido",
] as const;
function glyphUnits(text: string) {
  return Array.from(text.toLocaleUpperCase("pt-BR")).reduce(
    (sum, char) =>
      sum +
      (/\s/.test(char)
        ? 0.35
        : /[IÍIL1.,!|]/.test(char)
          ? 0.38
          : /[MW@]/.test(char)
            ? 1.05
            : 0.72),
    0,
  );
}
/** Illustration only; calibration for the approved default text is not a fixed width rule. */
export function estimateStickerPreview(text: string, scale: number) {
  const icon = 42,
    padding = 48,
    unit =
      (REFERENCE.stickerWidthBefore - icon - padding) /
      glyphUnits("Leia a matéria completa");
  const natural = icon + padding + glyphUnits(text) * unit,
    maxWidth = REFERENCE.width * 0.96;
  const width = Math.min(maxWidth, natural * scale),
    height = 116 * scale;
  return {
    text_length: stickerTextLength(text),
    width_px: width,
    height_px: height,
    width_pct: width / REFERENCE.width,
    capped: natural * scale > maxWidth,
    font_size_px: 54 * scale,
  };
}
/** Saved settings preview for Dashboard; does not represent a publication or measured Instagram bounds. */
export function dashboardStickerPreview(
  settings: import("./domain.js").StorySettings,
) {
  const s = settings.story.sticker,
    p = estimateStickerPreview(s.text, s.scale);
  const escape = (v: string) =>
    v.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  return `<section class="panel preview-panel"><h2>Padrão salvo do Story</h2><p class="muted">Simulação; largura real depende do Instagram.</p><div class="preview-shell"><div class="story-preview"><img src="/api/preview" alt="Mídia de teste"><div class="preview-sticker" data-style="${s.style_index}" data-capped="${p.capped}" title="${escape(s.text)}" style="display:${s.enabled ? "flex" : "none"};left:${s.x_pct * 100}%;top:${s.y_pct * 100}%;width:${p.width_pct * 100}%;height:${(p.height_px / REFERENCE.height) * 100}%;font-size:${(p.font_size_px / REFERENCE.width) * 100}cqw"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14l4-4m-6 7l-1 1a4 4 0 01-6-6l5-5a4 4 0 015.5-.2M16 7l1-1a4 4 0 016 6l-5 5a4 4 0 01-5.5.2" fill="none" stroke="currentColor" stroke-width="2"/></svg><span>${escape(s.text)}</span></div></div></div><p class="diagnostic">Caracteres: ${p.text_length} · Largura estimada: ${(p.width_pct * 100).toFixed(1)}% · Escala: ${(s.scale * 100).toFixed(1)}%</p><p class="muted">${PREVIEW_STYLE_LABELS[s.style_index]}${p.capped ? " · Preview limitado; texto completo preservado." : ""}</p><a href="#settings">Ajustar padrão →</a></section>`;
}
