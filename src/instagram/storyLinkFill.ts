import type { InstagramDriver } from './InstagramDriver.js';
import { detectInstagramState, resourceIdSelector, waitForState } from './instagramStateMachine.js';
import { clickExactLinkSticker } from './storyLinkInspection.js';
import { LINK_URL_ID, LINK_DONE_ID } from './linkEditorSelectors.js';

type Session = ReturnType<InstagramDriver['getSession']>;
const WAIT = { timeout: 20_000, interval: 500 };
export const DEFAULT_STORY_URL = 'https://plantaorio.com.br/';

export function resolveStoryUrl(argument?: string, environmentUrl?: string): string {
  const value = argument ?? environmentUrl ?? DEFAULT_STORY_URL;
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || value.trim() !== value) {
    throw new Error('STORY_URL deve ser uma URL HTTP(S) válida, sem espaços externos.');
  }
  // Retorna o valor original, sem normalizar barra final ou query string.
  return value;
}

export async function fillStoryLinkUrl(session: Session, url: string): Promise<string> {
  if (process.env.DRY_RUN !== 'true') throw new Error('Preencher link exige DRY_RUN=true.');
  resolveStoryUrl(url);
  const state = await detectInstagramState(session);
  console.log(`[STATE] ${state}`);
  if (state === 'STATE_STICKERS') {
    await clickExactLinkSticker(session);
    await waitForState(session, 'STATE_LINK_EDITOR');
  } else if (state !== 'STATE_LINK_EDITOR') {
    throw new Error(`${state}: este teste exige painel de Stickers ou editor do Link aberto; nenhuma navegação adicional.`);
  }
  const field = await session.$(resourceIdSelector(LINK_URL_ID));
  await field.waitForExist(WAIT);
  await field.waitForDisplayed(WAIT);
  if (!(await field.isEnabled())) throw new Error('Campo URL não está habilitado.');
  if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
  console.log('[1] Campo URL encontrado');
  console.log('[2] Limpando campo');
  await field.clearValue();
  console.log(`[3] Inserindo URL: ${url}`);
  await field.addValue(url);
  await session.waitUntil(async () => await field.getText() === url,
    { ...WAIT, timeoutMsg: 'O valor do campo URL não corresponde exatamente à URL informada.' });
  const actual = await field.getText();
  if (actual !== url) throw new Error(`Valor divergente: esperado ${JSON.stringify(url)}, recebido ${JSON.stringify(actual)}.`);
  console.log(`[4] Valor confirmado: ${actual}`);
  const done = await session.$(resourceIdSelector(LINK_DONE_ID));
  await done.waitForExist(WAIT);
  await done.waitForDisplayed(WAIT);
  console.log(`[5] Botão Done encontrado: ${LINK_DONE_ID}`);
  console.log('[6] DRY_RUN: não confirmar');
  // Done é somente observado: não há click, submit ou tecla Enter.
  return actual;
}
