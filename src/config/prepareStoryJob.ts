import { randomUUID } from 'node:crypto';
import { resolveStoryUrl } from '../instagram/storyLinkFill.js';
import { resolveStoryMedia,storyMediaInput } from '../media/resolveStoryMedia.js';
import type { StoryMediaHint } from '../media/StoryMedia.js';
import type { StoryJob,StoryJobInput } from './StoryJob.js';
/** A origem fornece conteúdo sem defaults ou alteração de URL/CTA. */
export async function validateStoryJobInput(input: StoryJobInput): Promise<StoryJob> {
  for (const name of ['story_url','sticker_text'] as const) if (!input[name]?.trim()) throw new Error(`${name} obrigatório.`);
  resolveStoryUrl(input.story_url);
  const media = await resolveStoryMedia(input.media?.trim() ? input.media : input.media_path ?? '',input.media_type ?? 'auto');
  if (media.type === 'UNSUPPORTED') throw new Error(`UNSUPPORTED_MEDIA: ${media.mimeType}`);
  return { job_id:input.job_id || randomUUID(),media,media_sha256:media.sha256,story_url:input.story_url,sticker_text:input.sticker_text,
    publish_instagram:input.publish_instagram ?? false,publish_facebook:input.publish_facebook ?? false };
}
export async function validatePrepareJob(environment: NodeJS.ProcessEnv = process.env): Promise<StoryJob> {
  for (const name of ['STORY_URL','STICKER_TEXT'] as const) if (!environment[name]?.trim()) throw new Error(`${name} obrigatório; nenhuma tarefa preparada.`);
  const job = await validateStoryJobInput({ job_id:environment.JOB_ID,media:storyMediaInput(environment),media_type:(environment.MEDIA_TYPE ?? 'auto') as StoryMediaHint,
    story_url:environment.STORY_URL!,sticker_text:environment.STICKER_TEXT! });
  console.log('[JOB] mídia validada');
  console.log(`[JOB] URL: ${job.story_url}`);
  console.log(`[JOB] sticker_text: ${job.sticker_text}`);
  return job;
}
