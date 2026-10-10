import 'dotenv/config';
import { resolve } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { analyzeResetHierarchy } from './normalizeInstagramToHome.js';
import { navigateFromHome } from './instagramStateMachine.js';
import { saveScreenArtifacts } from './diagnostics.js';

const driver = new InstagramDriver();
const directory = resolve('artifacts', `open-story-${Date.now()}`);
let connected = false;
try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true.');
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  const session = driver.getSession();
  if (analyzeResetHierarchy(await session.getPageSource()).state !== 'STATE_HOME') throw new Error('Este smoke exige STATE_HOME; execute smoke:instagram-reset-home antes.');
  await navigateFromHome(session, directory);
  await saveScreenArtifacts(driver, directory, 'story-opened');
  console.log('[OK] Story creation opened');
} catch (error: unknown) {
  console.error('[FAIL] Não foi possível abrir criação de Story:', error);
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
