export type StoryMediaType = 'IMAGE' | 'VIDEO' | 'UNSUPPORTED';
export type StoryMediaHint = 'image' | 'video' | 'auto';
export interface StoryMedia {
  path: string;
  type: StoryMediaType;
  mimeType: string;
  extension: string;
  filename: string;
  size: number;
  sha256: string;
}
export function assertExecutableStoryMedia(media: StoryMedia): void {
  if (media.type === 'VIDEO') throw new Error('VIDEO_EXECUTION_NOT_IMPLEMENTED: vídeo reconhecido; envio/criação/publicação de vídeo ainda não implementados.');
  if (media.type !== 'IMAGE') throw new Error(`UNSUPPORTED_MEDIA: ${media.mimeType}`);
}
