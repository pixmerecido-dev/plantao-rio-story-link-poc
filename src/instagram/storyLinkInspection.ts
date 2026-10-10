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

/** Gesto nativo por elementId; fallback de click apenas se execute falhar tecnicamente. */
export async function clickExactLinkSticker(session: Session, diagnosticDirectory = resolve('artifacts', `click-link-${Date.now()}`)): Promise<string> {
  if (process.env.DRY_RUN !== 'true') throw new Error('Inspecionar LINK exige DRY_RUN=true.');
  if (await detectInstagramState(session) !== 'STATE_STICKERS') throw new Error('Painel de stickers não confirmado.');
  const capture = (name: string) => saveScreenArtifacts({ getSession: () => session }, diagnosticDirectory, name);
  let observed: Record<string, unknown> | undefined;
  const locate = async () => {
    const matches = await session.$$(LINK_ACCESSIBILITY_SELECTOR);
    if (matches.length !== 1) throw new Error(`Esperado exatamente um Link Sticker; encontrados ${matches.length}. Nenhum clique adicional realizado.`);
    const [link] = matches;
    if (!link) throw new Error('Nenhum item Link Sticker.');
    observed = {
      'resource-id': await link.getAttribute('resource-id'), 'content-desc': await link.getAttribute('content-desc'),
      class: await link.getAttribute('class'), displayed: await link.isDisplayed(), enabled: await link.isEnabled(),
      clickable: await link.getAttribute('clickable'), bounds: await link.getAttribute('bounds'), elementId: link.elementId,
    };
    console.log('[STICKERS] Link Sticker encontrado:', JSON.stringify(observed));
    console.log(`[STICKERS] elementId=${link.elementId}`);
    if (observed['content-desc'] !== LINK_STICKER_DESCRIPTION || observed['resource-id'] !== STICKER_ITEM_ID ||
        observed.displayed !== true || observed.enabled !== true || !link.elementId) {
      throw new Error('LINK não está visível/habilitado ou sua identidade não foi confirmada.');
    }
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
    return link;
  };
  try {
    let link = await locate();
    await capture('click-link-before');
    let technicalFailure = false;
    try {
      console.log('[STICKERS] enviando mobile:clickGesture');
      await session.execute('mobile: clickGesture', { elementId: link.elementId });
    } catch (error: unknown) {
      // Uma conexão perdida não permite avaliar se o gesto chegou ao dispositivo.
      if (error instanceof Error && /connection|socket|ECONN/i.test(error.message)) throw error;
      technicalFailure = true;
      console.warn('[WARN] clickGesture falhou tecnicamente:', error);
    } finally {
      await capture('click-link-after');
    }
    let marker = await awaitLinkEditorMarker(session);
    if (marker) {
      console.log(`[STATE] STATE_LINK_EDITOR confirmado via clickGesture por ${marker}`);
      return LINK_ACCESSIBILITY_SELECTOR;
    }
    if (technicalFailure) {
      link = await locate();
      console.log('[STICKERS] fallback element.click após falha técnica');
      await capture('click-link-fallback-before');
      try { await link.click(); }
      catch (error: unknown) {
        if (error instanceof Error && /connection|socket|ECONN/i.test(error.message)) throw error;
        console.warn('[WARN] fallback element.click falhou tecnicamente:', error);
      }
      finally { await capture('click-link-fallback-after'); }
      marker = await awaitLinkEditorMarker(session);
      if (marker) {
        console.log(`[STATE] STATE_LINK_EDITOR confirmado via element.click por ${marker}`);
        return LINK_ACCESSIBILITY_SELECTOR;
      }
    }
    // Última tentativa só num único descendente visual do LINK revalidado.
    // Busca relativa ao elemento pai real, nunca na coleção global de stickers.
    link = await locate();
    const visuals = [];
    for (const child of await link.$$('android=new UiSelector().className("android.widget.ImageView")')) {
      if (child.elementId && await child.isExisting() && await child.isDisplayed() && await child.isEnabled()) visuals.push(child);
    }
    if (visuals.length === 1) {
      const [visual] = visuals;
      if (visual) {
        console.log('[STICKERS] descendente visual único pertencente ao Link Sticker:', visual.elementId);
        if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
        await capture('click-link-descendant-before');
        try { await session.execute('mobile: clickGesture', { elementId: visual.elementId }); }
        finally { await capture('click-link-descendant-after'); }
        marker = await awaitLinkEditorMarker(session);
        if (marker) {
          console.log(`[STATE] STATE_LINK_EDITOR confirmado via clickGesture descendente por ${marker}`);
          return LINK_ACCESSIBILITY_SELECTOR;
        }
      }
    }
    throw new Error('[ERROR] clickGesture não abriu Link Editor; descendente ausente, ambíguo ou sem transição.');
  } catch (error: unknown) {
    console.error('[ERROR] clickGesture não abriu Link Editor', error);
    console.error('Atributos observados do LINK:', JSON.stringify(observed));
    try { await capture('click-link-failed'); }
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
