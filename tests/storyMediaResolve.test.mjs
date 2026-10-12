import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveStoryMedia,storyMediaInput } from '../dist/media/resolveStoryMedia.js';
import { validatePrepareJob,validateStoryJobInput } from '../dist/config/prepareStoryJob.js';
import { assertExecutableStoryMedia } from '../dist/media/StoryMedia.js';
const jpeg = Buffer.from([255,216,255,224,0,16,74,70,73,70]);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYv8AAAAASUVORK5CYII=','base64');
const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d6d703432','hex');
const mov = Buffer.from('0000001466747970717420200000000071742020','hex');
const webp = Buffer.from('52494646140000005745425056503820080000000000000000000000','hex');
async function file(name,bytes) { const dir = await mkdtemp('/tmp/story-media-'); const path = join(dir,name); await writeFile(path,bytes); return path; }
test('nome WhatsApp com horário pontuado resolve automaticamente único .jpeg',async () => {
  const path = await file('WhatsApp Image 2026-10-10 at 01.02.02.jpeg',jpeg);
  const media = await resolveStoryMedia(path.slice(0,-5));
  assert.equal(media.path,path); assert.equal(media.type,'IMAGE'); assert.equal(media.mimeType,'image/jpeg');
  assert.equal(media.extension,'.jpg'); assert.equal(media.size,jpeg.length); assert.match(media.sha256,/^[a-f0-9]{64}$/);
});
for (const [name,bytes,type,mime] of [['photo.jpg',jpeg,'IMAGE','image/jpeg'],['photo.png',png,'IMAGE','image/png'],['photo.webp',webp,'IMAGE','image/webp'],['clip.mp4',mp4,'VIDEO','video/mp4'],['clip.mov',mov,'VIDEO','video/quicktime'],['no-extension',png,'IMAGE','image/png']]) test(`assinatura reconhece ${name}`,async () => {
  const media = await resolveStoryMedia(await file(name,bytes));
  assert.equal(media.type,type); assert.equal(media.mimeType,mime);
});
test('caminho exato sem extensão tem prioridade sobre candidatos adicionais',async () => {
  const path = await file('exact-name',jpeg); await writeFile(`${path}.png`,png);
  assert.equal((await resolveStoryMedia(path)).path,path);
});
test('extensão enganosa não determina MIME e media_type é validado',async () => {
  const path = await file('misleading.mp4',jpeg);
  assert.equal((await resolveStoryMedia(path)).type,'IMAGE');
  await assert.rejects(resolveStoryMedia(path,'video'),error => error.code === 'MEDIA_TYPE_MISMATCH');
  const unknown = await resolveStoryMedia(await file('fake.jpg',Buffer.from('not image')));
  assert.equal(unknown.type,'UNSUPPORTED'); assert.equal(unknown.mimeType,'application/octet-stream');
});
test('dois candidatos abortam AMBIGUOUS_MEDIA listando caminhos',async () => {
  const path = await file('same.jpeg',jpeg); await writeFile(path.replace('.jpeg','.png'),png);
  await assert.rejects(resolveStoryMedia(path.slice(0,-5)),error => error.code === 'AMBIGUOUS_MEDIA' && error.candidates.length === 2 && error.message.includes('.jpeg') && error.message.includes('.png'));
});
test('mídia inexistente ou sufixo reconhecido ausente retorna MEDIA_NOT_FOUND',async () => {
  const path = await file('exists.jpeg',jpeg);
  for (const input of [join(path,'absent'),path.replace('exists.jpeg','missing'),path.replace('.jpeg','.jpg')]) await assert.rejects(resolveStoryMedia(input),error => error.code === 'MEDIA_NOT_FOUND');
});
test('STORY_MEDIA tem prioridade e STORY_IMAGE permanece alias',() => {
  assert.equal(storyMediaInput({ STORY_MEDIA:'new',STORY_IMAGE:'old' }),'new');
  assert.equal(storyMediaInput({ STORY_IMAGE:'old' }),'old');
  assert.equal(storyMediaInput({ STORY_MEDIA:'',STORY_IMAGE:'old' }),'old');
  assert.throws(() => storyMediaInput({}),/STORY_MEDIA/);
});
test('job futuro media/auto usa valores exatos; VIDEO reconhecido sem executar Android',async () => {
  const path = await file('clip-without-extension',mp4);
  const job = await validateStoryJobInput({ media:path,story_url:'https://example.org/exact',sticker_text:' Texto recebido ' });
  assert.equal(job.media.type,'VIDEO'); assert.equal(job.sticker_text,' Texto recebido ');
  assert.equal(job.media_sha256,job.media.sha256);
  assert.throws(() => assertExecutableStoryMedia(job.media),/VIDEO_EXECUTION_NOT_IMPLEMENTED/);
  const env = await validatePrepareJob({ STORY_MEDIA:path,STORY_URL:job.story_url,STICKER_TEXT:job.sticker_text });
  assert.equal(env.media.type,'VIDEO'); assert.equal('image' in env,false);
});

test('mídia modificada após normalização não é enviada silenciosamente como mesmo job',async () => {
  const { resolveStoryMediaReference } = await import('../dist/media/resolveStoryMedia.js');
  const path = await file('original.jpg',jpeg), media = await resolveStoryMedia(path);
  await writeFile(path,png);
  await assert.rejects(resolveStoryMediaReference(media),error => error.code === 'MEDIA_CHANGED');
});
test('arquivo truncado não é validado pela extensão',async () => {
  const path = await file('truncated.png',Buffer.from([137,80,78,71,13,10,26,10]));
  const media = await resolveStoryMedia(path);
  assert.equal(media.type,'UNSUPPORTED');
});
