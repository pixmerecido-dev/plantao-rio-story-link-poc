import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { StoryLinkPublisher } from './StoryLinkPublisher.js';
import { InstagramDriver } from './InstagramDriver.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { resolveStoryUrl, fillStoryLinkUrl } from './storyLinkFill.js';

const driver = new InstagramDriver();
const publisher = new StoryLinkPublisher(driver);
const directory = resolve('artifacts', `story-link-fill-${Date.now()}`);
let connected = false;
try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true; não será alterado.');
  const url = resolveStoryUrl(process.argv[2], process.env.STORY_URL);
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  const confirmedValue = await fillStoryLinkUrl(driver.getSession(), url,
    () => publisher.loadImageIntoStory('assets/story-test.jpg', join(directory, 'image-flow')));
  await saveScreenArtifacts(driver, directory, 'link-filled');
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify({ confirmedValue, doneClicked: false, published: false }, null, 2)}\n`, 'utf8');
  console.log('[7] Sucesso');
} catch (error: unknown) {
  console.error('Falha ao preencher URL do Link Sticker:', error);
  process.exitCode = 1;
  if (connected) {
    try { await saveScreenArtifacts(driver, directory, 'error'); }
    catch (captureError: unknown) { console.error('Falha no diagnóstico de erro:', captureError); }
  }
} finally {
  try { await driver.disconnect(); }
  catch (error: unknown) {
    console.error('Falha ao encerrar apenas a sessão Appium:', error);
    process.exitCode = 1;
    if (connected) {
      try { await saveScreenArtifacts(driver, directory, 'error'); }
      catch (captureError: unknown) { console.error('Falha no diagnóstico de encerramento:', captureError); }
    }
  }
  console.log(`Artefatos: ${directory} (podem conter dados pessoais; ignorados pelo Git).`);
}
