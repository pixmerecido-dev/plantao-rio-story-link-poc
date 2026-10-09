import type { InstagramDriver } from './InstagramDriver.js';

type Session = ReturnType<InstagramDriver['getSession']>;
type Element = Awaited<ReturnType<Session['$']>>;
export type InstagramState = 'STATE_HOME' | 'STATE_CREATE' | 'STATE_UNKNOWN';
export const HOME_CREATE_ID = 'com.instagram.android:id/action_bar_left_button';
export const HOME_TAB_ID = 'com.instagram.android:id/feed_tab';
export const STORY_ID = 'com.instagram.android:id/cam_dest_story';
const WAIT = { timeout: 15_000, interval: 500 };

export function resourceIdSelector(id: string): string {
  return `android=new UiSelector().resourceId(${JSON.stringify(id)})`;
}

export async function detectInstagramState(session: Session): Promise<InstagramState> {
  // A aba Home pode coexistir com a criação: CREATE sempre tem prioridade.
  const story = await session.$(resourceIdSelector(STORY_ID));
  if (await story.isExisting()) return 'STATE_CREATE';
  const create = await session.$(resourceIdSelector(HOME_CREATE_ID));
  if (await create.isExisting()) return 'STATE_HOME';
  const home = await session.$(resourceIdSelector(HOME_TAB_ID));
  if (await home.isExisting()) return 'STATE_HOME';
  return 'STATE_UNKNOWN';
}

/** Equivalente nativo: o waitForClickable do WebdriverIO só suporta browsers. */
export async function waitForClickable(session: Session, element: Element): Promise<void> {
  await element.waitForExist(WAIT);
  await element.waitForDisplayed(WAIT);
  await session.waitUntil(async () =>
    await element.isDisplayed() && await element.isEnabled() && await element.getAttribute('clickable') === 'true',
  { ...WAIT, timeoutMsg: 'Elemento Android não ficou visível, habilitado e clickable=true.' });
}

async function clickNavigation(session: Session, id: string): Promise<void> {
  const element = await session.$(resourceIdSelector(id));
  await waitForClickable(session, element);
  if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
  await element.click();
}

export async function reachStoryCreation(session: Session, initialState: InstagramState, log: (message: string) => void = console.log): Promise<void> {
  if (initialState === 'STATE_CREATE') {
    log('[2] Navegação necessária: nenhuma; já está em STATE_CREATE');
  } else {
    log(`[2] Navegação necessária: ${initialState === 'STATE_UNKNOWN' ? 'aba Home e botão Criar' : 'botão Criar'}`);
    if (initialState === 'STATE_UNKNOWN') {
      await clickNavigation(session, HOME_TAB_ID);
      await session.waitUntil(async () => await detectInstagramState(session) === 'STATE_HOME', {
        ...WAIT, timeoutMsg: 'STATE_HOME não apareceu após clicar na aba Home.',
      });
    }
    // A interface pode ter avançado enquanto aguardávamos: não repetir navegação.
    if (await detectInstagramState(session) !== 'STATE_CREATE') {
      await clickNavigation(session, HOME_CREATE_ID);
    }
    await session.waitUntil(async () => await detectInstagramState(session) === 'STATE_CREATE', {
      ...WAIT, timeoutMsg: 'STATE_CREATE não apareceu após abrir criação.',
    });
  }
  const story = await session.$(resourceIdSelector(STORY_ID));
  await story.waitForExist(WAIT);
  await story.waitForDisplayed(WAIT);
  if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
  log('[3] Tela de criação confirmada');
  log(`[4] STORY encontrado por resource-id: ${STORY_ID}`);
  // Intencionalmente não há story.click().
}
