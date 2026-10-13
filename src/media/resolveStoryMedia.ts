import { readdir,stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename,dirname,extname,resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileTypeFromFile } from 'file-type';
import type { StoryMedia,StoryMediaHint } from './StoryMedia.js';
const extensions = new Set(['.jpg','.jpeg','.png','.webp','.mp4','.mov','.m4v','.webm']);
const images = new Set(['image/jpeg','image/png','image/webp']);
const videos = new Set(['video/mp4','video/quicktime','video/x-m4v','video/webm']);
export class StoryMediaError extends Error {
  constructor(public readonly code: string,message: string,public readonly candidates: string[] = []) { super(`${code}: ${message}`); }
}
export function storyMediaInput(environment: NodeJS.ProcessEnv = process.env): string {
  const input = environment.STORY_MEDIA?.trim() ? environment.STORY_MEDIA : environment.STORY_IMAGE;
  if (!input?.trim()) throw new StoryMediaError('MEDIA_NOT_FOUND','STORY_MEDIA obrigatório (STORY_IMAGE aceito temporariamente como alias).');
  return input;
}
/** Primeiro caminho exato; depois candidatos de mesma base no MESMO diretório. Tipo vem de assinatura. */
export async function resolveStoryMedia(inputPath: string,hint: StoryMediaHint = 'auto'): Promise<StoryMedia> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(inputPath)) throw new StoryMediaError('REMOTE_MEDIA_NOT_ALLOWED','Baixe e valide a mídia antes de entrar no motor.');
  if (!inputPath?.trim()) throw new StoryMediaError('MEDIA_NOT_FOUND','Caminho de mídia ausente.');
  if (!['image','video','auto'].includes(hint)) throw new StoryMediaError('INVALID_MEDIA_TYPE',String(hint));
  console.log(`[MEDIA] requested=${inputPath}`);
  let path = resolve(inputPath);
  let info;
  try { info = await stat(path); }
  catch (error) {
    if (!['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    if (extensions.has(extname(path).toLowerCase())) throw new StoryMediaError('MEDIA_NOT_FOUND',path);
    let entries;
    try { entries = await readdir(dirname(path),{ withFileTypes:true }); }
    catch (directoryError) {
      if (['ENOENT','ENOTDIR'].includes((directoryError as NodeJS.ErrnoException).code ?? '')) throw new StoryMediaError('MEDIA_NOT_FOUND',path);
      throw directoryError;
    }
    const requestedBase = basename(path);
    const equal = (a: string,b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
    const candidates = entries.filter(entry => entry.isFile() && extensions.has(extname(entry.name).toLowerCase()) && equal(basename(entry.name,extname(entry.name)),requestedBase)).map(entry => join(dirname(path),entry.name)).sort();
    if (candidates.length > 1) throw new StoryMediaError('AMBIGUOUS_MEDIA',`Mais de um arquivo corresponde: ${candidates.join(', ')}`,candidates);
    if (!candidates.length) throw new StoryMediaError('MEDIA_NOT_FOUND',path);
    for (const candidate of candidates) path = candidate;
    info = await stat(path);
  }
  if (!info.isFile()) throw new StoryMediaError('INVALID_MEDIA','O caminho não é arquivo regular.');
  let detected;
  try { detected = await fileTypeFromFile(path); }
  catch (error) { if (!(error instanceof Error) || (error.name !== 'EndOfStreamError' && error.constructor.name !== 'EndOfStreamError' && error.message !== 'End-Of-Stream')) throw error; }
  const mimeType = detected?.mime ?? 'application/octet-stream';
  const type = images.has(mimeType) ? 'IMAGE' : videos.has(mimeType) ? 'VIDEO' : 'UNSUPPORTED';
  const extension = detected ? `.${detected.ext}` : '';
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const media: StoryMedia = { path,type,mimeType,extension,filename:basename(path),size:info.size,sha256:hash.digest('hex') };
  console.log(`[MEDIA] resolved=${media.path}`);
  console.log(`[MEDIA] extension=${media.extension || '(desconhecida)'}`);
  console.log(`[MEDIA] mime=${media.mimeType}`);
  console.log(`[MEDIA] type=${media.type}`);
  console.log(`[MEDIA] size=${media.size}`);
  if (type !== 'UNSUPPORTED' && hint !== 'auto' && type.toLowerCase() !== hint) throw new StoryMediaError('MEDIA_TYPE_MISMATCH',`Informado ${hint}, detectado ${type}.`);
  return media;
}

/** Revalida objeto normalizado sem trocar silenciosamente a mídia do job. */
export async function resolveStoryMediaReference(reference: string | StoryMedia): Promise<StoryMedia> {
  const media = await resolveStoryMedia(typeof reference === 'string' ? reference : reference.path);
  if (typeof reference !== 'string' && (media.sha256 !== reference.sha256 || media.size !== reference.size || media.mimeType !== reference.mimeType)) throw new StoryMediaError('MEDIA_CHANGED','O arquivo mudou após a validação do job.');
  return media;
}
