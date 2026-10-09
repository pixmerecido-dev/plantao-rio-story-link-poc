import type { InstagramDriver } from './InstagramDriver.js';
import { extractInstagramElements, type InstagramElement } from './inspectElements.js';
import { detectInstagramState, resourceIdSelector, waitForClickable, STICKERS_ID, SHARE_SHORTCUT_ID } from './instagramStateMachine.js';
export { STICKERS_ID, SHARE_SHORTCUT_ID } from './instagramStateMachine.js';
import { selectorForObservedElement } from './storyMediaInspection.js';

type Session = ReturnType<InstagramDriver['getSession']>;
export const STICKERS_DESCRIPTION = 'Stickers';
export const STICKERS_SELECTORS = [resourceIdSelector(STICKERS_ID), `~${STICKERS_DESCRIPTION}`] as const;
const WAIT = { timeout: 20_000, interval: 500 };

export async function isStoryEditor(session: Session): Promise<boolean> {
  return await detectInstagramState(session) === 'STATE_EDITOR';
}

export function relevantStickerElements(elements: InstagramElement[]): InstagramElement[] {
  const seen = new Set<string>();
  return elements.filter(element => {
    const relevant = [element.text, element['content-desc']].some(label =>
      /\b(link|location|mention|gif|poll|music|hashtag)\b/i.test(label));
    const key = JSON.stringify(element);
    if (!relevant || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function linkStickerElements(elements: InstagramElement[]): InstagramElement[] {
  return relevantStickerElements(elements).filter(element =>
    [element.text, element['content-desc']].some(label => /^link$/i.test(label.trim())));
}

/** Abre somente o painel. Nunca procura Link para clicar nem aciona compartilhar. */
export async function openStickersPanel(session: Session): Promise<string> {
  if (process.env.DRY_RUN !== 'true') throw new Error('Abrir stickers exige DRY_RUN=true.');
  await session.waitUntil(async () => await isStoryEditor(session), {
    ...WAIT, timeoutMsg: 'Nenhum marcador real do editor de Story ficou visível.',
  });
  console.log('[1] Editor do Story confirmado');
  let selectedSelector: string | undefined;
  for (const selector of STICKERS_SELECTORS) {
    try {
      await session.waitUntil(async () => {
        const element = await session.$(selector);
        return await element.isExisting() && await element.isDisplayed() && await element.isEnabled();
      }, { ...WAIT, timeout: 10_000, timeoutMsg: `Stickers não disponível: ${selector}` });
      // Verifica cardinalidade sem indexar a coleção.
      if ((await session.$$(selector)).length !== 1) throw new Error(`Seletor Stickers ambíguo: ${selector}`);
      selectedSelector = selector;
      break;
    } catch (error: unknown) {
      if (selector === STICKERS_SELECTORS[1]) throw error;
      console.log('asset_button indisponível; tentando accessibility id Stickers.');
    }
  }
  if (!selectedSelector) throw new Error('Botão Stickers não encontrado.');
  const button = await session.$(selectedSelector);
  await waitForClickable(session, button);
  if (await button.getAttribute('content-desc') !== STICKERS_DESCRIPTION) {
    throw new Error('Botão não tem a descrição Stickers confirmada; clique cancelado.');
  }
  if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
  console.log(`[2] Stickers encontrado: ${selectedSelector}`);
  const before = extractInstagramElements(await session.getPageSource());
  const baseline = new Set(relevantStickerElements(before).map(element => JSON.stringify(element)));
  console.log('[3] Abrindo painel de stickers');
  await button.click();
  // Mudança de XML isolada não basta: exige nova opção de sticker observada e visível.
  await session.waitUntil(async () => {
    if (await session.getCurrentPackage() !== 'com.instagram.android') return false;
    const elements = extractInstagramElements(await session.getPageSource());
    for (const element of relevantStickerElements(elements)) {
      if (baseline.has(JSON.stringify(element))) continue;
      const selector = selectorForObservedElement(element);
      if (!selector) continue;
      const option = await session.$(selector);
      if (await option.isExisting() && await option.isDisplayed()) return true;
    }
    return false;
  }, { ...WAIT, timeoutMsg: 'Nenhuma nova opção de sticker visível apareceu após o único clique.' });
  console.log('[4] Painel de stickers aberto');
  return selectedSelector;
}
