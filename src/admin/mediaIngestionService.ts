import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { downloadStoryMedia } from '../media/downloadStoryMedia.js';
import type { PublicationQueueService } from './publicationQueueService.js';

/** Boundary after RSS/article resolver. No Appium or publication side effects. */
export class MediaIngestionService {
  constructor(private queue: PublicationQueueService, private directory = 'data/media',
    private recordsDirectory = 'data/ingestion') {}
  async ingest(input: {
    article_url: string; source_media_url: string; account_id: string;
    story_url: string; sticker_text: string;
  }) {
    const ingestion_id = randomUUID();
    const record: Record<string, unknown> = {
      ingestion_id, article_url: input.article_url, source_media_url: input.source_media_url,
      created_at: new Date().toISOString(), status: 'DOWNLOADING', job_id: null,
    };
    const save = async () => {
      await mkdir(resolve(this.recordsDirectory), { recursive: true });
      const path = join(resolve(this.recordsDirectory), `${ingestion_id}.json`);
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
      await rename(temporary, path);
    };
    await save();
    let media;
    try {
      media = await downloadStoryMedia(input.source_media_url, { directory: this.directory });
      Object.assign(record, media, { status: 'MEDIA_VALIDATED' });
      await save();
    } catch (error) {
      Object.assign(record, { status: 'MEDIA_DOWNLOAD_FAILED', error: String(error) });
      await save();
      return record;
    }
    try {
      const job = await this.queue.enqueueJob({ ...input, media_path: media.local_media_path,
        downloaded_media: media });
      Object.assign(record, { status: 'JOB_CREATED', job_id: job.job_id });
      await save();
      return record;
    } catch (error) {
      Object.assign(record, { status: 'JOB_CREATION_FAILED', error: String(error) });
      await save();
      throw error;
    }
  }
}
