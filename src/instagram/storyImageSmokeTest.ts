import 'dotenv/config';
import { resolve } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { StoryLinkPublisher } from './StoryLinkPublisher.js';
import { saveScreenArtifacts } from './diagnostics.js';

const driver = new InstagramDriver();
const publisher = new StoryLinkPublisher(driver);
const directory = resolve('artifacts', `story-image-${Date.now()}`);
let connected = false;

try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true; este teste não altera a variável.');
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  const filename = await publisher.findExistingTestImage(process.argv[2] ?? 'assets/story-test.jpg');
  await driver.openAndConfirmInstagram();
  await publisher.loadImageIntoStory(filename, directory);
} catch (error: unknown) {
  console.error('Falha no teste de imagem de Story:', error);
  process.exitCode = 1;
  if (connected) {
    try { await saveScreenArtifacts(driver, directory, 'error'); }
    catch (captureError: unknown) { console.error('Falha ao salvar diagnóstico de erro:', captureError); }
  }
} finally {
  // noReset=true + shouldTerminateApp=false: não termina o Instagram/editor.
  try { await driver.disconnect(); }
  catch (error: unknown) {
    console.error('Erro ao encerrar apenas a sessão Appium:', error);
    process.exitCode = 1;
    if (connected) {
      try { await saveScreenArtifacts(driver, directory, 'error'); }
      catch (captureError: unknown) { console.error('Falha ao salvar erro de encerramento:', captureError); }
    }
  }
  console.log(`Artefatos: ${directory} (podem conter dados pessoais; ignorados pelo Git).`);
}
