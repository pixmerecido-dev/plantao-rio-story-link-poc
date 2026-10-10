import type { InstagramDriver } from './InstagramDriver.js';
import type { InstagramElement } from './inspectElements.js';
import { resolve } from 'node:path';
import { saveScreenArtifacts } from './diagnostics.js';
import { LINK_EDITOR_MARKERS } from './linkEditorSelectors.js';
import { detectInstagramState, STICKER_ITEM_ID, LINK_STICKER_DESCRIPTION, resourceIdSelector } from './instagramStateMachine.js';

type Session = ReturnType<InstagramDriver['getSession']>;
export const LINK_ITEM_SELECTOR = `android=new UiSelector().resourceId(${JSON.stringify(STICKER_ITEM_ID)}).description(${JSON.stringify(LINK_STICKER_DESCRIPTION)})`;

export const LINK_ACCESSIBILITY_SELECTOR = '~Link Sticker';

/** Validação direta dos marcadores reais, independente da máquina genérica. */
export async function findLinkEditorMarker(session: Session): Promise<string | undefined> {
  for (const id of LINK_EDITOR_MARKERS) {
    const selector = resourceIdSelector(id);
    if ((await session.$$(selector)).length > 0) return selector;
  }
  return undefined;
}

async function awaitLinkEditorMarker(session: Session): Promise<string | undefined> {
  let marker: string | undefined;
  console.log('[WAIT] aguardando Link Editor');
  try {
    await session.waitUntil(async () => {
      marker = await findLinkEditorMarker(session);
      return marker !== undefined;
    }, { timeout: 5_000, interval: 400, timeoutMsg: 'Link Editor não apareceu após o clique.' });
  } catch (error: unknown) {
    if (!(error instanceof Error) || !/timeout|Link Editor não apareceu/i.test(error.message)) throw error;
  }
  return marker;
}

/** No máximo dois cliques no mesmo controle semântico, reconsultado pelo accessibility id. */
export async function clickExactLinkSticker(session: Session, diagnosticDirectory = resolve('artifacts', `click-link-${Date.now()}`)): Promise<string> {
  if (process.env.DRY_RUN !== 'true') throw new Error('Inspecionar LINK exige DRY_RUN=true.');
  if (await detectInstagramState(session) !== 'STATE_STICKERS') throw new Error('Painel de stickers não confirmado.');
  let observed: Record<string, unknown> | undefined;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      // Evita clique extra se a transição terminou entre a espera e a reconsulta.
      const alreadyOpen = await findLinkEditorMarker(session);
      if (alreadyOpen) {
        console.log(`[STATE] STATE_LINK_EDITOR confirmado por ${alreadyOpen}`);
        return LINK_ACCESSIBILITY_SELECTOR;
      }
      const matches = await session.$$(LINK_ACCESSIBILITY_SELECTOR);
      if (matches.length !== 1) throw new Error(`Esperado exatamente um Link Sticker; encontrados ${matches.length}. Nenhum clique adicional realizado.`);
      const [link] = matches;
      if (!link) throw new Error('Nenhum item Link Sticker.');
      observed = {
        'resource-id': await link.getAttribute('resource-id'),
        'content-desc': await link.getAttribute('content-desc'),
        class: await link.getAttribute('class'),
        displayed: await link.isDisplayed(), enabled: await link.isEnabled(),
        clickable: await link.getAttribute('clickable'), bounds: await link.getAttribute('bounds'),
        elementId: link.elementId,
      };
      console.log('[STICKERS] Link Sticker encontrado:', JSON.stringify(observed));
      console.log(`[STICKERS] clickable=${String(observed.clickable)}`);
      if (observed['content-desc'] !== LINK_STICKER_DESCRIPTION || observed['resource-id'] !== STICKER_ITEM_ID ||
          observed.displayed !== true || observed.enabled !== true || !link.elementId) {
        throw new Error('LINK não está visível/habilitado ou sua identidade não foi confirmada.');
      }
      if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
      console.log(`[STICKERS] tentativa ${attempt}`);
      await link.click();
      const marker = await awaitLinkEditorMarker(session);
      if (marker) {
        console.log(`[STATE] STATE_LINK_EDITOR confirmado por ${marker}`);
        return LINK_ACCESSIBILITY_SELECTOR;
      }
      if (attempt === 1) console.warn('[WARN] primeira tentativa não navegou');
    }
    throw new Error('STATE_STICKERS: duas tentativas em LINK não abriram o Link Editor.');
  } catch (error: unknown) {
    console.error('Atributos observados do LINK:', JSON.stringify(observed));
    try { await saveScreenArtifacts({ getSession: () => session }, diagnosticDirectory, 'click-link-failed'); }
    catch (captureError: unknown) { console.error('Falha ao salvar diagnóstico do clique:', captureError); }
    throw error;
  }
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

export async function waitForLinkEditor(session: Session, _beforeSource?: string): Promise<void> {
  const marker = await awaitLinkEditorMarker(session);
  if (!marker) throw new Error('Link Editor não apareceu: nenhum seletor real confirmado.');
  console.log(`[STATE] STATE_LINK_EDITOR confirmado por ${marker}`);
}
