import type { StoryMedia } from '../media/StoryMedia.js';
import { openAddStory, AddStoryRouteExhaustedError } from './addStoryInteraction.js';
import { openStoryViaCreate } from './storyCreateRoute.js';
import type { AndroidRunner } from './addStoryAndroidDiagnostics.js';
import type { InstagramDriver } from './InstagramDriver.js';
import { analyzeResetHierarchy } from './normalizeInstagramToHome.js';
import { navigateFromHome, HOME_CREATE_ID, resourceIdSelector, type InstagramState } from './instagramStateMachine.js';
import { saveScreenArtifacts } from './diagnostics.js';

type Driver = Pick<InstagramDriver, 'getSession'>;

/** Entrada única: nenhuma criação se a hierarquia atual não comprovar Home real. */
export async function openStoryFromHome(driver: Driver, directory: string, options: { afterMediaScan?: boolean; runAdb?: AndroidRunner } = {}): Promise<InstagramState> {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true.');
  const session = driver.getSession();
  if (options.afterMediaScan) {
    console.log('[MEDIA] aguardando estabilização');
    await session.pause(2_000);
  }
  const { source } = await saveScreenArtifacts(driver, directory, options.afterMediaScan ? 'media-home-stabilized' : 'open-story-home');
  if (await session.getCurrentPackage() !== 'com.instagram.android' || analyzeResetHierarchy(source).state !== 'STATE_HOME') {
    throw new Error('Abertura exige STATE_HOME real; nenhuma tentativa de Add to story será enviada.');
  }
  if (options.afterMediaScan) {
    console.log('[MEDIA] STATE_HOME reconfirmado');
    console.log('[MEDIA] Home estabilizada');
    console.log('[HOME] reacquirindo Add to story após media scan');
  }
  let addAvailable = false;
  for (const element of await session.$$('~Add to story')) if (await element.isExisting() && await element.isDisplayed()) addAvailable = true;
  if (!addAvailable) {
    // Keep the older explicit Create control; otherwise use the observed contextual + route.
    const traditional = await session.$$(resourceIdSelector(HOME_CREATE_ID));
    for (const element of traditional)
      if (await element.isExisting() && await element.isDisplayed()) return navigateFromHome(session, directory);
    console.log('[HOME] Add to story ausente; iniciando fallback Create/+');
    return openStoryViaCreate(driver, directory);
  }
  try { return await openAddStory(session, directory, { runAdb: options.runAdb }); }
  catch (error) {
    if (!(error instanceof AddStoryRouteExhaustedError)) throw error;
    if (await session.getCurrentPackage() !== 'com.instagram.android' || analyzeResetHierarchy(await session.getPageSource()).state !== 'STATE_HOME') throw error;
    console.log('[HOME] rota Add to story falhou');
    console.log('[HOME] iniciando fallback Create/+');
    return openStoryViaCreate(driver, directory);
  }
}

/** Mesma sequência de injeção/abertura em story-prepare e no smoke isolado. */
export async function injectMediaAndOpenStory(driver: Driver, publisher: { prepareMedia(media: string | StoryMedia): Promise<string> }, media: string | StoryMedia, directory: string) {
  // Falha antes de enviar mídia se o teste não começar na Home comprovada.
  const session = driver.getSession();
  if (process.env.DRY_RUN !== 'true' || await session.getCurrentPackage() !== 'com.instagram.android' ||
    analyzeResetHierarchy(await session.getPageSource()).state !== 'STATE_HOME') throw new Error('Injeção de mídia exige DRY_RUN=true e STATE_HOME.');
  const filename = await publisher.prepareMedia(media);
  const state = await openStoryFromHome(driver, directory, { afterMediaScan: true });
  return { filename, state };
}
