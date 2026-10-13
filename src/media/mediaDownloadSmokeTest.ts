import 'dotenv/config';
import { downloadStoryMedia } from './downloadStoryMedia.js';
if (!process.env.SOURCE_MEDIA_URL) throw new Error('SOURCE_MEDIA_URL obrigatório.');
try {
  const media = await downloadStoryMedia(process.env.SOURCE_MEDIA_URL);
  console.log(JSON.stringify(media, null, 2));
  console.log(`[OK] mídia local validada; STORY_MEDIA=${media.local_media_path}`);
} catch (error) { console.error('[FAIL] MEDIA_DOWNLOAD_FAILED', error); process.exitCode = 1; }
