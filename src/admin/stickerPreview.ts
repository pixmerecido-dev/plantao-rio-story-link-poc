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
  const icon = 52,
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
    font_size_px: 70 * scale,
  };
}
/** One visual object: text, icon, padding, gap and shape share one transform. */
export function applyStickerPreview(
  sticker: HTMLElement,
  text: string,
  scale: number,
  canvasWidth: number,
) {
  const natural = estimateStickerPreview(text, 1);
  const pixels = canvasWidth / REFERENCE.width;
  // Size the unscaled object using the dynamic natural width; transform scales all children once.
  sticker.style.width = `${natural.width_px * pixels}px`;
  sticker.style.height = `${natural.height_px * pixels}px`;
  sticker.style.fontSize = `${natural.font_size_px * pixels}px`;
  sticker.style.lineHeight = "1";
  sticker.style.padding = `${12 * pixels}px ${24 * pixels}px`;
  sticker.style.gap = `${16 * pixels}px`;
  sticker.style.borderRadius = `${14 * pixels}px`;
  sticker.style.transform = `translate(-50%, -50%) scale(${scale})`;
  const icon = sticker.querySelector<SVGElement>("svg");
  if (icon) {
    icon.style.width = `${52 * pixels}px`;
    icon.style.height = `${52 * pixels}px`;
  }
  const label = sticker.querySelector<HTMLElement>("span");
  if (label) {
    label.textContent = text;
    // Fit the base text once; never use a minimum font size or fit again after scaling.
    label.style.fontSize = "inherit";
    label.style.lineHeight = "1";
    label.style.textOverflow = "clip";
    const available = Math.max(
      1,
      natural.width_px * pixels - (52 + 48 + 16) * pixels,
    );
    const measured = label.scrollWidth;
    if (measured > available)
      label.style.fontSize = `${(natural.font_size_px * pixels * available) / measured}px`;
  }
  sticker.dataset.scale = String(scale);
}
export function refreshDashboardPreview(
  settings: import("./domain.js").StorySettings,
) {
  document
    .querySelectorAll<HTMLElement>(".dashboard-bottom .preview-sticker")
    .forEach((sticker) => {
      const canvas = sticker.closest<HTMLElement>(".story-preview");
      if (canvas)
        applyStickerPreview(
          sticker,
          settings.story.sticker.text,
          settings.story.sticker.scale,
          canvas.clientWidth,
        );
    });
}
/** Saved configuration only; never claims measured Instagram appearance or a publication. */
export function dashboardStickerPreview(
  settings: import("./domain.js").StorySettings,
) {
  const s = settings.story.sticker;
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
  return `<section class="panel preview-panel"><h2>Aparência do Story</h2><p class="muted">Prévia aproximada do seu padrão.</p><div class="preview-shell"><div class="story-preview"><img src="/api/preview" alt="Imagem de referência"><div class="preview-sticker" data-style="${s.style_index}" title="${escape(s.text)}" style="display:${s.enabled ? "flex" : "none"};left:${s.x_pct * 100}%;top:${s.y_pct * 100}%"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14l4-4m-6 7l-1 1a4 4 0 01-6-6l5-5a4 4 0 015.5-.2M16 7l1-1a4 4 0 016 6l-5 5a4 4 0 01-5.5.2" fill="none" stroke="currentColor" stroke-width="2"/></svg><span>${escape(s.text)}</span></div></div></div><p class="muted">${PREVIEW_STYLE_LABELS[s.style_index]}</p><a href="#settings">Ajustar aparência →</a></section>`;
}
