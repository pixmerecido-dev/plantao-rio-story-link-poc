import type { InstagramElement } from './inspectElements.js';

export function selectorForObservedElement(element: InstagramElement): string | undefined {
  // Combina apenas atributos observados, sem usar posição, XPath ou coordenadas.
  let selector = 'android=new UiSelector()';
  if (element['resource-id']) selector += `.resourceId(${JSON.stringify(element['resource-id'])})`;
  if (element['content-desc']) selector += `.description(${JSON.stringify(element['content-desc'])})`;
  if (element.text) selector += `.text(${JSON.stringify(element.text)})`;
  if (selector === 'android=new UiSelector()') return undefined;
  if (element.class) selector += `.className(${JSON.stringify(element.class)})`;
  return selector;
}

export function isUnsafeMediaControl(element: InstagramElement): boolean {
  const labels = [element.text, element['content-desc'], element['resource-id']].join(' ').replace(/[_-]/g, ' ');
  return /\b(share|sharing|publish|send|post|compartilhar|publicar|enviar|sticker|stickers|link)\b/i.test(labels);
}

export function isNamedMedia(element: InstagramElement, filename: string): boolean {
  if (isUnsafeMediaControl(element)) return false;
  // Nome completo, não correspondência parcial com outro arquivo.
  return [element.text, element['content-desc']].some(value =>
    value === filename || value === `/sdcard/Pictures/PlantaoRio/${filename}` ||
    value.split(/[\s,;:]+/).includes(filename));
}

export function observedImageCandidates(elements: InstagramElement[]): InstagramElement[] {
  const seen = new Set<string>();
  return elements.filter(element => {
    if (!/ImageView|ImageButton/i.test(element.class) || isUnsafeMediaControl(element)) return false;
    const selector = selectorForObservedElement(element);
    if (!selector || seen.has(selector)) return false;
    seen.add(selector);
    return true;
  });
}
