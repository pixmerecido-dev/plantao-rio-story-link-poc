import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadStoryMedia } from '../dist/media/downloadStoryMedia.js';
import { resolveStoryMedia } from '../dist/media/resolveStoryMedia.js';
import { MediaIngestionService } from '../dist/admin/mediaIngestionService.js';
import { OperationsStorage } from '../dist/admin/operationsStorage.js';
import { initialOperationsState, DEFAULT_ACCOUNT_ID } from '../dist/admin/operationsDomain.js';
import { PublicationQueueService } from '../dist/admin/publicationQueueService.js';

test('download boundary: real HTTP, signature, hash, persistence and failure isolation', async () => {
  const bytes = await readFile(resolve('assets/story-test.jpg'));
  const directory = await mkdtemp(join(tmpdir(), 'ingestion-'));
  const server = createServer((req,res) => {
    if (req.url === '/missing') { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', req.url === '/wrong' ? 'image/png' : 'image/jpeg');
    res.end(req.url === '/empty' ? Buffer.alloc(0) : bytes);
  });
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const media = await downloadStoryMedia(`${base}/photo.jpeg`, { directory });
    assert.equal(media.extension,'.jpg');
    assert.equal(media.mime_type,'image/jpeg');
    assert.equal(media.file_size,bytes.length);
    assert.equal(media.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(await readFile(media.local_media_path),bytes);
    assert.equal(media.source_media_url,`${base}/photo.jpeg`);
    assert.ok(Date.parse(media.downloaded_at));
    assert.equal((await downloadStoryMedia(`${base}/photo.jpeg`, { directory })).local_media_path,media.local_media_path);
    for (const path of ['/empty','/wrong','/missing']) await assert.rejects(downloadStoryMedia(base+path, { directory }));
    await assert.rejects(downloadStoryMedia(`${base}/large`, { directory, maxBytes: 1 }));
    await assert.rejects(downloadStoryMedia('file:///secret', { directory }));
    assert.equal((await readdir(directory)).some(p=>p.endsWith('.part')),false);
    await assert.rejects(resolveStoryMedia(`${base}/photo.jpeg`),/REMOTE_MEDIA_NOT_ALLOWED/);
    const store = new OperationsStorage(join(directory,'operations.json'),initialOperationsState());
    const queue = new PublicationQueueService(store);
    const service = new MediaIngestionService(queue,join(directory,'media'),join(directory,'records'));
    const input = { article_url:'https://example.com/article', source_media_url:`${base}/missing`,
      account_id:DEFAULT_ACCOUNT_ID, story_url:'https://example.com/article', sticker_text:'Leia a matéria' };
    const failed = await service.ingest(input);
    assert.equal(failed.status,'MEDIA_DOWNLOAD_FAILED');
    assert.equal((await store.read()).queue.length,0);
    assert.equal(JSON.parse(await readFile(join(directory,'records',`${failed.ingestion_id}.json`))).source_media_url,input.source_media_url);
    const success = await service.ingest({...input,source_media_url:`${base}/photo.jpeg`});
    assert.equal(success.status,'JOB_CREATED');
    const job = (await store.read()).queue[0];
    assert.equal(job.media_path,success.local_media_path);
    assert.equal(job.downloaded_media.sha256,success.sha256);
    assert.equal(job.story_url,input.story_url);
    assert.equal(job.sticker_text,input.sticker_text);
    assert.ok((await store.read()).events.some(e=>e.metadata?.source_media_url===`${base}/photo.jpeg`));
  } finally { await new Promise(r=>server.close(r)); await rm(directory,{recursive:true,force:true}); }
});
