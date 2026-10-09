import type { InstagramElement } from './inspectElements.js';

export type ObservedControl = { element: InstagramElement; selector: string };

// Rótulos usados para filtrar atributos observados, nunca como seletores presumidos.
// Não oferece Next/Share/Send, miniaturas, stickers ou controles de publicação.
const creationLabels = new Set([
  'create', 'create new', 'create new post', 'new post',
  'criar', 'criar novo', 'criar conteúdo', 'criar nova publicação', 'nova publicação',
]);

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function storyOptionObserved(elements: InstagramElement[]): boolean {
  return elements.some(element => [element.text, element['content-desc']]
    .some(value => ['story', 'stories'].includes(normalize(value))));
}

export function observedCreationControls(elements: InstagramElement[]): ObservedControl[] {
  const controls: ObservedControl[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    if (![element.text, element['content-desc']].some(value => creationLabels.has(normalize(value)))) continue;
    const selector = element['resource-id']
      ? `android=new UiSelector().resourceId(${JSON.stringify(element['resource-id'])})`
      : element['content-desc'] ? `~${element['content-desc']}`
      : `android=new UiSelector().text(${JSON.stringify(element.text)})`;
    if (seen.has(selector)) continue;
    seen.add(selector);
    controls.push({ element, selector });
  }
  return controls;
}
