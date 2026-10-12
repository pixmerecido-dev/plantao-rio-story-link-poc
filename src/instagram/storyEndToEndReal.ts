import { assertExecutableStoryMedia } from '../media/StoryMedia.js';
import { requireApprovedStickerLayout } from './approvedStickerLayout.js';
import { join } from 'node:path';
import type { InstagramDriver } from './InstagramDriver.js';
import type { StoryJob } from '../config/StoryJob.js';
import { prepareNewStory } from './storyPrepare.js';
import { requireCurrentLinkTransaction } from './appliedLinkSticker.js';
import { assertRealPublishAllowed, publishStoryOnce } from './storyPublishReal.js';
import { injectMediaAndOpenStory } from './openStoryFromHome.js';
import { StoryLinkPublisher } from './StoryLinkPublisher.js';

type Driver = InstagramDriver;
type Job = StoryJob & { media_sha256: string };

/** Nenhum subprocesso ou reconexão entre preparação, confirmação e clique único. */
export async function prepareAndPublishStory(driver: Driver, job: Job, directory: string) {
  assertExecutableStoryMedia(job.media);
  const publisher = new StoryLinkPublisher(driver);
  return completeCurrentStoryJob(driver, job, directory, () => prepareNewStory(driver, job, directory, async () => {
    const imageDirectory = join(directory, 'image-flow');
    const { filename } = await injectMediaAndOpenStory(driver, publisher, job.media, imageDirectory);
    await publisher.loadMediaIntoStory(job.media, imageDirectory, { requireNewImage: true, expectedFilename: filename });
    console.log(`[STORY] imagem carregada: ${filename}`);
  }));
}

/** Mantém a mesma sessão e falha antes de publicar quando a preparação não confirma o job. */
export async function completeCurrentStoryJob<T>(driver: Pick<InstagramDriver, 'getSession'>, job: Job, directory: string,
  prepare: () => Promise<T>, clock?: Parameters<typeof publishStoryOnce>[2]) {
  const prepared = await prepare();
  await requireCurrentLinkTransaction(driver.getSession(), job.job_id);
  await requireApprovedStickerLayout(driver.getSession(),job.job_id);
  // Travas só liberam publicação após confirmar a preparação do job atual.
  assertRealPublishAllowed();
  const publication = await publishStoryOnce(driver, directory, clock, job);
  return { job_id: job.job_id, media_sha256: job.media_sha256, prepared, publication };
}
