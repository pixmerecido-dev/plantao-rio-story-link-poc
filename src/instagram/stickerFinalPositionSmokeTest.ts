import 'dotenv/config';
import { resolve } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { positionCurrentSticker } from './stickerFinalPosition.js';
const driver = new InstagramDriver();
const directory = resolve('artifacts',`sticker-final-position-${Date.now()}`);
try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true.');
  await driver.checkAppium();
  await driver.connect();
  // Somente editor atual, sem abrir Instagram, criar Story ou alterar URL/CTA.
  await positionCurrentSticker(driver,directory);
} catch (error) { console.error('[FAIL] Posição final não confirmada:',error); process.exitCode = 1; }
finally {
  try { await driver.disconnect(); } catch (error) { console.error('Falha ao encerrar sessão:',error); process.exitCode = 1; }
  console.log(`Artefatos: ${directory}`);
}
