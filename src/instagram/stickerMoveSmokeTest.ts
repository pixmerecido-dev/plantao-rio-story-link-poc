import 'dotenv/config';
import { resolve } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { testNativeStickerMovement } from './stickerNativeMoveTest.js';
const driver = new InstagramDriver();
const directory = resolve('artifacts', `sticker-move-${Date.now()}`);
try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true.');
  await driver.checkAppium();
  await driver.connect();
  // Não activateApp/back/normalização: inspeciona somente o editor deixado pelo usuário.
  await testNativeStickerMovement(driver, directory);
} catch (error) { console.error('[FAIL] Movimento não confirmado:', error); process.exitCode = 1; }
finally {
  try { await driver.disconnect(); } catch (error) { console.error('Falha ao encerrar sessão:', error); process.exitCode = 1; }
  console.log(`Artefatos: ${directory}`);
}
