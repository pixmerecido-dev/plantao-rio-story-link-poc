import 'dotenv/config';
import { resolve } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { normalizeInstagramToHome } from './normalizeInstagramToHome.js';
import { openStoryViaCreate } from './storyCreateRoute.js';
import { saveScreenArtifacts } from './diagnostics.js';

const driver = new InstagramDriver();
const directory = resolve('artifacts', `open-story-via-create-${Date.now()}`);
let connected = false;
try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true.');
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  await normalizeInstagramToHome(driver, directory);
  await openStoryViaCreate(driver, directory);
  console.log('[OK] Create route reached Story gallery');
} catch (error) {
  console.error('[FAIL] Rota Create não abriu galeria:', error); process.exitCode = 1;
  if (connected) {
    try { await saveScreenArtifacts(driver, directory, 'error'); } catch (captureError) { console.error('Falha na captura:', captureError); }
  }
} finally {
  try { await driver.disconnect(); } catch (error) { console.error('Falha ao encerrar sessão:', error); process.exitCode = 1; }
  console.log(`Artefatos: ${directory}`);
}
