import 'dotenv/config';
import { resolveStoryMedia,storyMediaInput } from './resolveStoryMedia.js';
import type { StoryMediaHint } from './StoryMedia.js';
try {
  const media = await resolveStoryMedia(storyMediaInput(),(process.env.MEDIA_TYPE ?? 'auto') as StoryMediaHint);
  console.log(`[MEDIA] ready=${media.type !== 'UNSUPPORTED'}`);
  if (media.type === 'UNSUPPORTED') process.exitCode = 1;
} catch (error) { console.error('[MEDIA] ready=false',error); process.exitCode = 1; }
