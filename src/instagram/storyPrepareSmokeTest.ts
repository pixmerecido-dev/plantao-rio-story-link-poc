import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { StoryLinkPublisher } from './StoryLinkPublisher.js';
import { validatePrepareJob } from '../config/prepareStoryJob.js';
import { prepareNewStory } from './storyPrepare.js';
import { saveScreenArtifacts } from './diagnostics.js';

const driver = new InstagramDriver();
const publisher = new StoryLinkPublisher(driver);
const directory = resolve('artifacts', `story-prepare-${Date.now()}`);
let connected = false;
try {
  const job = await validatePrepareJob(); // Obrigatoriamente antes de Appium/Instagram/ADB.
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true.');
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  const result = await prepareNewStory(driver, job, directory, async () => {
    // Cada execução envia uma cópia nova, tornando esta mídia a mais recente em Recents.
    const filename = await publisher.prepareImage(job.image);
    await publisher.loadImageIntoStory(job.image, join(directory, 'image-flow'), { requireNewImage: true, expectedFilename: filename });
    console.log(`[STORY] imagem carregada: ${filename}`);
  });
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
} catch (error: unknown) {
  console.error('Falha ao preparar novo Story:', error); process.exitCode = 1;
  if (connected) {
    try { await saveScreenArtifacts(driver, directory, 'error'); }
    catch (captureError: unknown) { console.error('Falha na captura de erro:', captureError); }
  }
} finally {
  try { await driver.disconnect(); }
  catch (error: unknown) { console.error('Falha ao encerrar sessão Appium:', error); process.exitCode = 1; }
  console.log(`Artefatos: ${directory}`);
}
