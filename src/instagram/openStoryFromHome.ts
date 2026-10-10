import type { InstagramDriver } from './InstagramDriver.js';
import { analyzeResetHierarchy } from './normalizeInstagramToHome.js';
import { navigateFromHome, type InstagramState } from './instagramStateMachine.js';
import { saveScreenArtifacts } from './diagnostics.js';

type Driver = Pick<InstagramDriver, 'getSession'>;

/** Entrada única: nenhuma criação se a hierarquia atual não comprovar Home real. */
export async function openStoryFromHome(driver: Driver, directory: string, options: { afterMediaScan?: boolean } = {}): Promise<InstagramState> {
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
  return navigateFromHome(session, directory);
}

/** Mesma sequência de injeção/abertura em story-prepare e no smoke isolado. */
export async function injectMediaAndOpenStory(driver: Driver, publisher: { prepareImage(image: string): Promise<string> }, image: string, directory: string) {
  // Falha antes de enviar mídia se o teste não começar na Home comprovada.
  const session = driver.getSession();
  if (process.env.DRY_RUN !== 'true' || await session.getCurrentPackage() !== 'com.instagram.android' ||
    analyzeResetHierarchy(await session.getPageSource()).state !== 'STATE_HOME') throw new Error('Injeção de mídia exige DRY_RUN=true e STATE_HOME.');
  const filename = await publisher.prepareImage(image);
  const state = await openStoryFromHome(driver, directory, { afterMediaScan: true });
  return { filename, state };
}
