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
      /\b(link|website|url|location|mention|gif|poll|music|hashtag)\b/i.test(label));
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
  console.log('[1] STATE_EDITOR confirmado');
  const byResourceId = await session.$(STICKERS_SELECTORS[0]);
  const useResourceId = await byResourceId.isExisting();
  const selectedSelector = useResourceId ? STICKERS_SELECTORS[0] : STICKERS_SELECTORS[1];
  console.log(useResourceId ? '[2] asset_button encontrado' : '[2] asset_button ausente; fallback por accessibility id Stickers');
  const button = useResourceId ? byResourceId : await session.$(selectedSelector);
  // Se o ID existe mas não é visível/clicável, aguarda ou falha sem escolher outro nó.
  await waitForClickable(session, button);
  if ((await session.$$(selectedSelector)).length !== 1) throw new Error(`Seletor Stickers ambíguo: ${selectedSelector}`);
  if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
  // A descrição pode estar em um filho/elemento separado. É apenas informação.
  const descriptionNode = await session.$(STICKERS_SELECTORS[1]);
  const separateDescriptionVisible = await descriptionNode.isExisting() && await descriptionNode.isDisplayed();
  console.log(`Confirmação adicional: descrição Stickers visível na tela=${separateDescriptionVisible}`);
  console.log(useResourceId ? '[3] Stickers confirmado por resource-id' : '[3] Stickers confirmado por accessibility id');
  const before = extractInstagramElements(await session.getPageSource());
  const baseline = new Set(relevantStickerElements(before).map(element => JSON.stringify(element)));
  console.log(`Abrindo painel de stickers com um único clique: ${selectedSelector}`);
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
  console.log('[4] Painel aberto');
  return selectedSelector;
}
