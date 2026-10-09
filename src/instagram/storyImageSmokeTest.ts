import 'dotenv/config';
import { InstagramDriver } from './InstagramDriver.js';
import { StoryLinkPublisher } from './StoryLinkPublisher.js';

const driver = new InstagramDriver();
const publisher = new StoryLinkPublisher(driver);

try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true; este teste não altera a variável.');
  console.log('[1/6] Conectando ao Appium');
  await driver.checkAppium();
  await driver.connect();
  console.log('[2/6] Preparando imagem no emulador');
  const filename = await publisher.prepareImage(process.argv[2] ?? 'assets/story-test.jpg');
  console.log('[3/6] Abrindo Instagram');
  await driver.openAndConfirmInstagram();
  await publisher.loadImageIntoStory(filename);
} catch (error: unknown) {
  console.error('Falha no teste de imagem de Story:', error);
  process.exitCode = 1;
} finally {
  // noReset=true + shouldTerminateApp=false: DELETE /session não termina o Instagram.
  try { await driver.disconnect(); }
  catch (error: unknown) {
    console.error('Erro ao encerrar apenas a sessão Appium:', error);
    process.exitCode = 1;
  }
}
