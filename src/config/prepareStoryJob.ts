import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolveStoryUrl } from '../instagram/storyLinkFill.js';
import type { StoryJob } from './StoryJob.js';

/** Sem defaults de conteúdo: preserva todos os valores fornecidos pela origem. */
export async function validatePrepareJob(environment: NodeJS.ProcessEnv = process.env): Promise<StoryJob & { image_sha256: string }> {
  for (const name of ['STORY_IMAGE', 'STORY_URL', 'STICKER_TEXT'] as const) {
    if (!environment[name] || !environment[name]?.trim()) throw new Error(`${name} obrigatório; nenhuma tarefa preparada.`);
  }
  const image = environment.STORY_IMAGE!, story_url = environment.STORY_URL!, sticker_text = environment.STICKER_TEXT!;
  resolveStoryUrl(story_url);
  const bytes = await readFile(image);
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('STORY_IMAGE deve ser JPEG válido nesta POC.');
  const job = { job_id: environment.JOB_ID || randomUUID(), image, story_url, sticker_text,
    publish_instagram: false, publish_facebook: false, image_sha256: createHash('sha256').update(bytes).digest('hex') };
  console.log('[JOB] imagem validada');
  console.log(`[JOB] URL: ${story_url}`);
  console.log(`[JOB] sticker_text: ${sticker_text}`);
  return job;
}
