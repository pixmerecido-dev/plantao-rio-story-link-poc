import type { InstagramDriver } from './InstagramDriver.js';
import { navigateFromHome, resourceIdSelector, STORY_ID, type InstagramState } from './instagramStateMachine.js';

export { detectInstagramState, resourceIdSelector, waitForClickable, HOME_CREATE_ID, HOME_TAB_ID, STORY_ID, type InstagramState } from './instagramStateMachine.js';

/** Diagnóstico só chega à criação: nunca retorna da galeria/editor para Home. */
export async function reachStoryCreation(session: ReturnType<InstagramDriver['getSession']>, initialState: InstagramState,
  log: (message: string) => void = console.log): Promise<void> {
  if (initialState !== 'STATE_HOME' && initialState !== 'STATE_CREATE') {
    throw new Error(`${initialState}: não é necessário nem seguro voltar para Home neste diagnóstico.`);
  }
  if (initialState === 'STATE_HOME') {
    const next = await navigateFromHome(session);
    if (next !== 'STATE_CREATE') {
      log(`[NAV] ${next}: diagnóstico encerrado sem selecionar mídia ou navegar novamente.`);
      return;
    }
  }
  const story = await session.$(resourceIdSelector(STORY_ID));
  await story.waitForExist({ timeout: 20_000 });
  await story.waitForDisplayed({ timeout: 20_000 });
  log('[OK] Tela de criação confirmada; STORY encontrado, sem clicar');
}
