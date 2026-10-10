/** Contrato futuro; estas opções não autorizam publicação nem alteram configurações. */
export interface StoryJob {
  image: string;
  story_url: string;
  sticker_text: string;
  publish_instagram: boolean;
  publish_facebook: boolean;
}
