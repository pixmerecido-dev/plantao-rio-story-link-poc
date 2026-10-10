import 'dotenv/config';
import { resolve } from 'node:path';
import { prepareAndIndexImage } from './mediaIndex.js';

const directory = resolve('artifacts', `media-index-${Date.now()}`);
try {
  const image = process.env.STORY_IMAGE;
  if (!image?.trim()) throw new Error('STORY_IMAGE obrigatório.');
  await prepareAndIndexImage(image, { directory });
  console.log('[OK] mídia indexada e confirmada no MediaStore');
} catch (error: unknown) {
  console.error('[FAIL] Não foi possível confirmar a indexação:', error);
  process.exitCode = 1;
} finally {
  console.log(`Artefatos: ${directory}`);
}
