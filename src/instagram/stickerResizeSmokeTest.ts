import 'dotenv/config';
import { resolve } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { testCurrentStickerResize } from './stickerResize.js';
const driver = new InstagramDriver();
const directory = resolve('artifacts', `sticker-resize-${Date.now()}`);
try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true.');
  await driver.checkAppium();
  await driver.connect();
  // Somente editor atual: sem activateApp, back, preparação ou confirmação de publicação.
  await testCurrentStickerResize(driver, directory);
} catch (error) { console.error('[FAIL] Resize não confirmado:', error); process.exitCode = 1; }
finally {
  try { await driver.disconnect(); } catch (error) { console.error('Falha ao encerrar sessão:', error); process.exitCode = 1; }
  console.log(`Artefatos: ${directory}`);
}
