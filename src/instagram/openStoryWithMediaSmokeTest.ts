import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { StoryLinkPublisher } from './StoryLinkPublisher.js';
import { injectMediaAndOpenStory } from './openStoryFromHome.js';
import { clickNavigation, STORY_ID, waitForState } from './instagramStateMachine.js';
import { saveScreenArtifacts } from './diagnostics.js';

const driver = new InstagramDriver();
const directory = resolve('artifacts', `open-story-with-media-${Date.now()}`);
let connected = false;
try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true.');
  const image = process.env.STORY_IMAGE;
  if (!image?.trim()) throw new Error('STORY_IMAGE obrigatório.');
  const bytes = await readFile(image);
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('STORY_IMAGE deve ser JPEG válido.');
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  const result = await injectMediaAndOpenStory(driver, new StoryLinkPublisher(driver), image, directory);
  // Variante antiga chega a CREATE: abre apenas STORY, sem selecionar miniatura.
  if (result.state === 'STATE_CREATE') {
    await clickNavigation(driver.getSession(), STORY_ID);
    await waitForState(driver.getSession(), 'STATE_GALLERY');
  } else if (result.state !== 'STATE_GALLERY') throw new Error(`Exige galeria sem seleção de mídia; encontrado ${result.state}.`);
  await saveScreenArtifacts(driver, directory, 'story-gallery');
  console.log('[OK] Story creation opened after media injection');
} catch (error: unknown) {
  console.error('[FAIL] Não foi possível abrir Story após injeção de mídia:', error);
  process.exitCode = 1;
  if (connected) {
    try { await saveScreenArtifacts(driver, directory, 'error'); }
    catch (captureError) { console.error('Falha na captura:', captureError); }
  }
} finally {
  try { await driver.disconnect(); }
  catch (error) { console.error('Falha ao encerrar sessão Appium:', error); process.exitCode = 1; }
  console.log(`Artefatos: ${directory}`);
}
