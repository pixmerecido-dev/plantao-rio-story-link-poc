import type { InstagramDriver } from './InstagramDriver.js';
import { detectInstagramState, navigateFromHome, waitForState } from './instagramStateMachine.js';
import { ensureStickersPanel } from './storyStickers.js';
import { clickExactLinkSticker } from './storyLinkInspection.js';

type Session = ReturnType<InstagramDriver['getSession']>;

/** Compõe os fluxos existentes; não replica cliques de Home, Story ou galeria. */
export async function navigateToLinkEditor(session: Session, prepareStoryEditor?: () => Promise<void>): Promise<void> {
  if (process.env.DRY_RUN !== 'true') throw new Error('Navegação exige DRY_RUN=true.');
  let state = await detectInstagramState(session);
  console.log(`[STATE] Estado inicial: ${state}`);
  if (state === 'STATE_UNKNOWN') throw new Error('STATE_UNKNOWN: nenhuma navegação presumida; abortando.');
  if (state === 'STATE_HOME') state = await navigateFromHome(session);
  if (state === 'STATE_CREATE' || state === 'STATE_GALLERY') {
    if (!prepareStoryEditor) throw new Error('Fluxo de imagem reutilizável não fornecido para obter o editor.');
    await prepareStoryEditor();
    state = await detectInstagramState(session);
  }
  if (state === 'STATE_EDITOR') {
    console.log('[NAV] EDITOR -> STICKERS');
    await ensureStickersPanel(session);
    await waitForState(session, 'STATE_STICKERS');
    state = await detectInstagramState(session);
  }
  if (state === 'STATE_STICKERS') {
    console.log('[NAV] STICKERS -> LINK_EDITOR');
    await clickExactLinkSticker(session);
    // clickExactLinkSticker já validou diretamente os marcadores reais.
    state = 'STATE_LINK_EDITOR';
  }
  if (state !== 'STATE_LINK_EDITOR') throw new Error(`${state}: configuração do link não foi alcançada.`);
}
