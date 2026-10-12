import { storyMediaInput } from '../media/resolveStoryMedia.js';
import 'dotenv/config';
import { resolve } from 'node:path';
import { prepareAndIndexMedia } from './mediaIndex.js';

const directory = resolve('artifacts', `media-index-${Date.now()}`);
try {
  const media = storyMediaInput();
  await prepareAndIndexMedia(media, { directory });
  console.log('[OK] mídia indexada e confirmada no MediaStore');
} catch (error: unknown) {
  console.error('[FAIL] Não foi possível confirmar a indexação:', error);
  process.exitCode = 1;
} finally {
  console.log(`Artefatos: ${directory}`);
}
