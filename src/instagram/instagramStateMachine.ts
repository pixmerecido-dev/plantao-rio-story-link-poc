import type { InstagramDriver } from './InstagramDriver.js';
import { hasStickerPanel } from './stickerCollection.js';
export { STICKER_ITEM_ID, LINK_STICKER_DESCRIPTION } from './stickerCollection.js';

type Session = ReturnType<InstagramDriver['getSession']>;
type Element = Awaited<ReturnType<Session['$']>>;
export type InstagramState = 'STATE_HOME' | 'STATE_CREATE' | 'STATE_GALLERY' | 'STATE_EDITOR' | 'STATE_STICKERS' | 'STATE_UNKNOWN';
export const HOME_CREATE_ID = 'com.instagram.android:id/action_bar_left_button';
export const HOME_TAB_ID = 'com.instagram.android:id/feed_tab';
export const STORY_ID = 'com.instagram.android:id/cam_dest_story';
export const GALLERY_ID = 'com.instagram.android:id/gallery_grid_container';
export const STICKERS_ID = 'asset_button';
export const SHARE_SHORTCUT_ID = 'com.instagram.android:id/your_story_share_shortcut_button';
const WAIT = { timeout: 20_000, interval: 500 };

export function resourceIdSelector(id: string): string {
  return `android=new UiSelector().resourceId(${JSON.stringify(id)})`;
}

/** Probes sem waitForExist: ausência normal não causa timeout ou exceção. */
export async function detectInstagramState(session: Session): Promise<InstagramState> {
  if (await hasStickerPanel(session)) return 'STATE_STICKERS';
  const probes: { state: InstagramState; selectors: string[] }[] = [
    { state: 'STATE_EDITOR', selectors: [resourceIdSelector(STICKERS_ID), resourceIdSelector(SHARE_SHORTCUT_ID), '~Stickers'] },
    { state: 'STATE_GALLERY', selectors: [resourceIdSelector(GALLERY_ID)] },
    { state: 'STATE_CREATE', selectors: [resourceIdSelector(STORY_ID)] },
    { state: 'STATE_HOME', selectors: [resourceIdSelector(HOME_TAB_ID), resourceIdSelector(HOME_CREATE_ID)] },
  ];
  for (const probe of probes) {
    for (const selector of probe.selectors) {
      try {
        const element = await session.$(selector);
        if (await element.isExisting() && await element.isDisplayed()) return probe.state;
      } catch (error: unknown) {
        // Não ocultar erros de conexão/servidor; só ausência ou stale em uma transição.
        if (!(error instanceof Error) || !/no such element|stale element reference/i.test(error.message)) throw error;
      }
    }
  }
  return 'STATE_UNKNOWN';
}

/** O waitForClickable nativo verifica atributos Android, sem API de browser. */
export async function waitForClickable(session: Session, element: Element): Promise<void> {
  await element.waitForExist(WAIT);
  await element.waitForDisplayed(WAIT);
  await session.waitUntil(async () => await element.isDisplayed() && await element.isEnabled() &&
    await element.getAttribute('clickable') === 'true',
  { ...WAIT, timeoutMsg: 'Elemento Android não ficou visível, habilitado e clicável.' });
}

export async function clickNavigation(session: Session, id: typeof HOME_CREATE_ID | typeof STORY_ID): Promise<void> {
  const element = await session.$(resourceIdSelector(id));
  await waitForClickable(session, element);
  if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
  await element.click();
}

export async function waitForState(session: Session, expected: InstagramState): Promise<void> {
  await session.waitUntil(async () => await detectInstagramState(session) === expected,
    { ...WAIT, timeoutMsg: `${expected} não apareceu após a navegação.` });
}

/** Seleção de mídia é injetada; pode ser reutilizado por imagem e stickers. */
export async function navigateToStoryEditor(session: Session, selectImage: () => Promise<void>) {
  if (process.env.DRY_RUN !== 'true') throw new Error('A máquina de estados exige DRY_RUN=true.');
  const initialState = await detectInstagramState(session);
  let state = initialState;
  const transitions: string[] = [];
  console.log(`[STATE] Estado detectado: ${state}`);
  // HOME -> CREATE -> GALLERY -> EDITOR, sem repetição de cliques após timeout.
  for (let step = 0; step < 4; step++) {
    if (state === 'STATE_EDITOR') {
      if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
      console.log('[NAV] Editor já disponível; nenhuma seleção/navegação adicional');
      console.log('[OK] Editor do Story confirmado');
      return { initialState, finalState: state, transitions };
    }
    if (state === 'STATE_STICKERS') throw new Error('STATE_STICKERS: painel já aberto; não voltar ao editor nem selecionar mídia.');
    if (state === 'STATE_UNKNOWN') throw new Error('STATE_UNKNOWN: abortando sem tentar Home ou clicar em controles desconhecidos.');
    if (state === 'STATE_HOME') {
      console.log('[NAV] HOME -> CREATE: clicando uma vez em Criar');
      await clickNavigation(session, HOME_CREATE_ID);
      transitions.push('HOME -> CREATE');
      await waitForState(session, 'STATE_CREATE');
    } else if (state === 'STATE_CREATE') {
      console.log('[NAV] CREATE -> GALLERY: clicando uma vez em STORY');
      await clickNavigation(session, STORY_ID);
      transitions.push('CREATE -> GALLERY');
      await waitForState(session, 'STATE_GALLERY');
    } else {
      console.log('[NAV] GALLERY -> EDITOR: selecionando uma única miniatura');
      await selectImage();
      transitions.push('GALLERY -> EDITOR');
      await waitForState(session, 'STATE_EDITOR');
    }
    state = await detectInstagramState(session);
    console.log(`[STATE] Estado detectado: ${state}`);
  }
  throw new Error('Limite de transições atingido; nenhuma navegação adicional será tentada.');
}
