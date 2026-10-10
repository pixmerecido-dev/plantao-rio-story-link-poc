/** Contrato futuro; estas opções não autorizam publicação nem alteram configurações. */
export interface StoryJob {
  job_id: string;
  image: string;
  story_url: string;
  sticker_text: string;
  publish_instagram: boolean;
  publish_facebook: boolean;
}
