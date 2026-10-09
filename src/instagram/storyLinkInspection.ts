import type { InstagramDriver } from './InstagramDriver.js';
import type { InstagramElement } from './inspectElements.js';
import { detectInstagramState, resourceIdSelector, STICKER_ITEM_ID, LINK_STICKER_DESCRIPTION } from './instagramStateMachine.js';

type Session = ReturnType<InstagramDriver['getSession']>;
const WAIT = { timeout: 20_000, interval: 500 };
export const LINK_ITEM_SELECTOR = `android=new UiSelector().resourceId(${JSON.stringify(STICKER_ITEM_ID)}).description(${JSON.stringify(LINK_STICKER_DESCRIPTION)})`;

/** O ID é compartilhado: filtra pelo content-desc exato e recusa ambiguidade. */
export async function clickExactLinkSticker(session: Session): Promise<string> {
  if (process.env.DRY_RUN !== 'true') throw new Error('Inspecionar LINK exige DRY_RUN=true.');
  if (await detectInstagramState(session) !== 'STATE_STICKERS') throw new Error('Painel de stickers não confirmado.');
  const items = await session.$$(resourceIdSelector(STICKER_ITEM_ID));
  console.log(`[1] Stickers encontrados: ${items.length}`);
  if (items.length === 0) throw new Error('Nenhum item com resource-id confirmado; não clicar pelo accessibility id sozinho.');
  console.log('[2] Procurando content-desc exato "Link Sticker"');
  const links = [];
  for (const item of items) {
    const observed = {
      'content-desc': await item.getAttribute('content-desc'),
      text: await item.getText(),
      'resource-id': await item.getAttribute('resource-id'),
      displayed: await item.isDisplayed(),
    };
    console.log(`Item observado: ${JSON.stringify(observed)}`);
    if (observed['content-desc'] === LINK_STICKER_DESCRIPTION) links.push(item);
  }
  console.log(`[3] LINK encontrado: ${links.length}`);
  if (links.length !== 1) throw new Error(`Esperado exatamente um Link Sticker; encontrados ${links.length}. Nenhum clique realizado.`);
  // Sem índices: a coleção já foi filtrada e a cardinalidade é exatamente um.
  for (const link of links) {
    await link.waitForExist(WAIT);
    await link.waitForDisplayed(WAIT);
    await session.waitUntil(async () => await link.isEnabled(), { ...WAIT, timeoutMsg: 'LINK não ficou habilitado.' });
    if (await link.getAttribute('resource-id') !== STICKER_ITEM_ID ||
        await link.getAttribute('content-desc') !== LINK_STICKER_DESCRIPTION) throw new Error('Item LINK mudou antes do clique.');
    if ((await session.$$(LINK_ITEM_SELECTOR)).length !== 1) throw new Error('Item LINK ficou ambíguo antes do clique.');
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
    console.log('[4] Clicando em LINK');
    await link.click();
  }
  return LINK_ITEM_SELECTOR;
}

export function inspectLinkEditorElements(elements: InstagramElement[]) {
  const labels = (element: InstagramElement) => [element.text, element['content-desc'], element['resource-id'].replace(/[_-]/g, ' ')];
  const relevant = elements.filter(element => labels(element)
    .some(label => /\b(url|link|website|web address|done|customize sticker text|sticker text)\b/i.test(label)));
  // Lista candidatos observados; não presume que qualquer EditText seja campo URL.
  const urlFields = relevant.filter(element => /EditText$/i.test(element.class) &&
    labels(element).some(label => /\b(url|link|website|web address)\b/i.test(label)));
  const confirmations = relevant.filter(element => [element.text, element['content-desc']]
    .some(label => /^done$/i.test(label.trim())));
  return { relevant, urlFields, confirmations };
}

export async function waitForLinkEditor(session: Session, beforeSource: string): Promise<void> {
  await session.waitUntil(async () => {
    if (await session.getCurrentPackage() !== 'com.instagram.android') return false;
    const source = await session.getPageSource();
    if (source === beforeSource) return false;
    // Exige saída do painel, não apenas uma pequena alteração no XML.
    const panelItems = await session.$$(resourceIdSelector(STICKER_ITEM_ID));
    for (const item of panelItems) if (await item.isDisplayed()) return false;
    const linkOptions = await session.$$(`~${LINK_STICKER_DESCRIPTION}`);
    for (const linkOption of linkOptions) if (await linkOption.isDisplayed()) return false;
    const { extractInstagramElements } = await import('./inspectElements.js');
    const observed = inspectLinkEditorElements(extractInstagramElements(source));
    return observed.urlFields.length > 0 || observed.confirmations.length > 0 || observed.relevant.some(element =>
      [element.text, element['content-desc']].some(label => /customize sticker text|web address|sticker text|\burl\b/i.test(label)));
  }, { ...WAIT, timeoutMsg: 'Tela de configuração do link não foi reconhecida após o único clique.' });
}
