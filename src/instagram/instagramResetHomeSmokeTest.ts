import 'dotenv/config';
import { resolve } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { normalizeInstagramToHome } from './normalizeInstagramToHome.js';

const driver = new InstagramDriver();
const directory = resolve('artifacts', `instagram-reset-home-${Date.now()}`);

try {
  await driver.checkAppium();
  await driver.connect();
  await driver.openAndConfirmInstagram();
  // A rotina detecta o estado, salva as capturas e exige Home estabilizada.
  // Não chama qualquer fluxo de criação, mídia, stickers ou publicação.
  await normalizeInstagramToHome(driver, directory);
  console.log('[OK] Instagram normalizado para Home');
} catch (error: unknown) {
  console.error('[FAIL] Não foi possível normalizar para STATE_HOME');
  console.error(error);
  process.exitCode = 1;
} finally {
  try { await driver.disconnect(); }
  catch (error: unknown) {
    console.error('Falha ao encerrar sessão Appium:', error);
    process.exitCode = 1;
  }
  console.log(`Artefatos: ${directory}`);
}
