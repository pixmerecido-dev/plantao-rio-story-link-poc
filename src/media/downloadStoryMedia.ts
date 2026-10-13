import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { resolveStoryMedia } from './resolveStoryMedia.js';

export interface DownloadedMedia {
  source_media_url: string;
  local_media_path: string;
  mime_type: string;
  extension: string;
  file_size: number;
  sha256: string;
  downloaded_at: string;
}
const extensions: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4',
};
export function mediaURL(value: string): URL {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Mídia exige URL HTTP(S) sem credenciais.');
  return url;
}
/** Streaming limitado; arquivo temporário só é promovido após assinatura, tamanho e hash válidos. */
export async function downloadStoryMedia(source: string, options: {
  directory?: string; maxBytes?: number; timeoutMs?: number;
} = {}): Promise<DownloadedMedia> {
  let url = mediaURL(source);
  const directory = resolve(options.directory ?? 'data/media');
  const maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetch(url, { signal, redirect: 'manual' });
    if (![301,302,303,307,308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === 5) throw new Error('Redirecionamento de mídia inválido/excessivo.');
    url = mediaURL(new URL(location, url).href);
  }
  if (!response?.ok || !response.body) throw new Error(`Download HTTP ${response?.status ?? 'sem resposta'}`);
  const mime = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const extension = extensions[mime];
  if (!extension) { await response.body.cancel(); throw new Error(`Content-Type não suportado: ${mime}`); }
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) { await response.body.cancel(); throw new Error('Mídia excede limite de download.'); }
  const stem = basename(new URL(source).pathname).replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0,64) || 'story';
  // URL digest separates different sources with the same basename; no untrusted directories.
  const key = createHash('sha256').update(source).digest('hex').slice(0,16);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${stem}-${randomUUID()}.part`);
  let size = 0;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new Error('Mídia excede limite de download.');
        await handle.writeFile(chunk);
      }
    } finally { await handle.close(); }
    if (!size) throw new Error('Mídia vazia.');
    if (response.headers.has('content-length') && declared !== size) throw new Error('Download incompleto.');
    const media = await resolveStoryMedia(temporary);
    if (media.mimeType !== mime || media.size !== size || media.type === 'UNSUPPORTED')
      throw new Error('Assinatura/tamanho não corresponde ao Content-Type.');
    // Include content identity; never overwrite a file already attached to another job.
    const destination = join(directory, `${stem}-${key}-${media.sha256.slice(0,16)}${extension}`);
    await rename(temporary, destination);
    const confirmed = await resolveStoryMedia(destination);
    if (confirmed.sha256 !== media.sha256 || confirmed.size !== size) throw new Error('Arquivo local não confirmado.');
    return { source_media_url: source, local_media_path: destination, mime_type: mime,
      extension, file_size: size, sha256: confirmed.sha256, downloaded_at: new Date().toISOString() };
  } finally { await rm(temporary, { force: true }); }
}
