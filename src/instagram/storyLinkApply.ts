import type { InstagramDriver } from './InstagramDriver.js';
import type { InstagramElement } from './inspectElements.js';
import { fillStoryLinkUrl } from './storyLinkFill.js';
import { LINK_DONE_ID } from './linkEditorSelectors.js';
import { detectInstagramState, resourceIdSelector, waitForClickable, waitForState } from './instagramStateMachine.js';

type Session = ReturnType<InstagramDriver['getSession']>;

/** Confirma apenas o sticker. Nenhum controle de publicação é usado. */
export async function applyStoryLink(session: Session, url: string, prepareStoryEditor?: () => Promise<void>): Promise<string> {
  const value = await fillStoryLinkUrl(session, url, prepareStoryEditor, { confirmationFollows: true });
  console.log('[1] URL preenchida');
  if (await detectInstagramState(session) !== 'STATE_LINK_EDITOR') throw new Error('Configuração do link não está mais aberta.');
  const done = await session.$(resourceIdSelector(LINK_DONE_ID));
  await waitForClickable(session, done);
  if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
  console.log('[2] Done encontrado');
  console.log('[3] Clicando em Done');
  await done.click();
  // Timeout aborta sem repetir Done e sem clicar em qualquer botão do editor.
  await waitForState(session, 'STATE_EDITOR');
  if (await detectInstagramState(session) !== 'STATE_EDITOR') throw new Error('Retorno ao editor não confirmado.');
  console.log('[4] Retorno ao editor confirmado');
  return value;
}

/** Evidências observadas; botão Stickers ou texto genérico não provam aplicação. */
export function inspectAppliedLink(elements: InstagramElement[], url: string) {
  const host = new URL(url).hostname;
  const relevant = elements.filter(element => [element.text, element['content-desc'], element['resource-id']]
    .some(label => /link|sticker|\burl\b|plantaorio\.com\.br/i.test(label) || label.includes(host) || label.includes(url)));
  const evidence = relevant.filter(element => [element.text, element['content-desc']]
    .some(label => label.includes(url) || label.toLowerCase().includes(host.toLowerCase()) || /\blink sticker\b/i.test(label)));
  return { relevant, evidence, confirmedByHierarchy: evidence.length > 0 };
}
