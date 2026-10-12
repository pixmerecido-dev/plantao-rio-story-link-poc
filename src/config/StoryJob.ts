import type { StoryMedia,StoryMediaHint } from '../media/StoryMedia.js';
/** Contrato comum: reconhecimento VIDEO não implementa sua publicação. */
export interface StoryJob {
  job_id: string;
  media: StoryMedia;
  media_sha256: string;
  story_url: string;
  sticker_text: string;
  publish_instagram: boolean;
  publish_facebook: boolean;
}
export interface StoryJobInput {
  job_id?: string;
  media?: string;
  media_path?: string;
  media_type?: StoryMediaHint;
  story_url: string;
  sticker_text: string;
  publish_instagram?: boolean;
  publish_facebook?: boolean;
}
