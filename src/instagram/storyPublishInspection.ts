import type { InstagramDriver } from './InstagramDriver.js';
import { extractInstagramElements, type InstagramElement } from './inspectElements.js';
import { detectInstagramState, resourceIdSelector, SHARE_SHORTCUT_ID } from './instagramStateMachine.js';
import { applyStoryLink, inspectAppliedLink } from './storyLinkApply.js';

type Session = ReturnType<InstagramDriver['getSession']>;

/** Trava obrigatória para qualquer futura implementação de clique de publicação. */
export function assertPublishAllowed(value = process.env.ALLOW_PUBLISH): void {
  if (value !== 'true') {
    console.log('[SAFE] Publicação bloqueada.');
    throw new Error('Publicação exige ALLOW_PUBLISH=true.');
  }
}

export async function ensureEditorWithLink(session: Session, url: string, prepareStoryEditor: () => Promise<void>) {
  if (process.env.DRY_RUN !== 'true') throw new Error('Inspeção exige DRY_RUN=true.');
  let confirmedBy = 'validated-flow';
  const state = await detectInstagramState(session);
  const elements = state === 'STATE_EDITOR' ? extractInstagramElements(await session.getPageSource()) : [];
  const host = new URL(url).hostname.toLowerCase();
  const visibleUrl = inspectAppliedLink(elements, url).evidence.some(element =>
    [element.text, element['content-desc']].some(label => label.includes(url) || label.toLowerCase().includes(host)));
  if (state === 'STATE_EDITOR' && visibleUrl) confirmedBy = 'editor-hierarchy-domain';
  else await applyStoryLink(session, url, prepareStoryEditor);
  if (await detectInstagramState(session) !== 'STATE_EDITOR') throw new Error('Editor final não confirmado.');
  console.log('[1] Story com LINK confirmado');
  // Estado composto local: não interfere na detecção rápida usada pelos outros fluxos.
  return { state: 'STATE_EDITOR_WITH_LINK', confirmedBy, url } as const;
}

export type PublishControl = InstagramElement & { selector: string; clickable: string | null; enabled: boolean };

export async function inspectPublishControls(session: Session) {
  if (await detectInstagramState(session) !== 'STATE_EDITOR') throw new Error('Inspeção de publicação exige editor visível.');
  if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
  const read = async (selector: string): Promise<PublishControl[]> => {
    const found: PublishControl[] = [];
    for (const element of await session.$$(selector)) {
      if (!await element.isExisting() || !await element.isDisplayed()) continue;
      found.push({ selector, 'resource-id': await element.getAttribute('resource-id') ?? '',
        'content-desc': await element.getAttribute('content-desc') ?? '', text: await element.getText(),
        class: await element.getAttribute('class') ?? '', clickable: await element.getAttribute('clickable'),
        enabled: await element.isEnabled() });
    }
    return found;
  };
  const yourStorySelectors = [resourceIdSelector(SHARE_SHORTCUT_ID), '~Your story', 'android=new UiSelector().text("Your story")'];
  let yourStory: PublishControl | undefined;
  for (const selector of yourStorySelectors) {
    const found = await read(selector);
    if (found.length > 1) throw new Error('Your story ambíguo; nenhum controle selecionado ou clicado.');
    if (found.length === 1) { [yourStory] = found; break; }
  }
  if (!yourStory) throw new Error('Your story não identificado; nenhum clique realizado.');
  const otherControls: PublishControl[] = [];
  for (const label of ['Close Friends', 'Next']) {
    for (const selector of [`~${label}`, `android=new UiSelector().text(${JSON.stringify(label)})`]) {
      otherControls.push(...await read(selector));
    }
  }
  // Registra candidatos adicionais somente da hierarquia real; não inventa ID de seta.
  const related = extractInstagramElements(await session.getPageSource()).filter(element =>
    [element.text, element['content-desc']].some(label => /close friends|\bnext\b|arrow|seta/i.test(label)));
  console.log('[2] Botão "Your story" encontrado');
  console.log(`[3] Seletor real: ${JSON.stringify(yourStory)}`);
  console.log('Outros controles observados:', JSON.stringify({ otherControls, related }, null, 2));
  const allowPublish = process.env.ALLOW_PUBLISH === 'true';
  console.log(`[4] ALLOW_PUBLISH=${allowPublish}`);
  if (!allowPublish) {
    try { assertPublishAllowed(); } catch { /* Diagnóstico termina com sucesso, sem publicar. */ }
  }
  // Mesmo com autorização habilitada este módulo somente inspeciona: não tem click.
  console.log('[5] Publicação bloqueada: esta etapa apenas inspeciona');
  return { yourStory, otherControls, related, allowPublish, published: false as const };
}
