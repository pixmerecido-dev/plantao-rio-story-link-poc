import type { InstagramElement } from './inspectElements.js';

export const HOME_CREATE_ID = 'com.instagram.android:id/action_bar_left_button';
export const HOME_CREATE_DESCRIPTION = 'Create a post, story, reel or live video.';
export const HOME_CREATE_SELECTORS = [
  `android=new UiSelector().resourceId(${JSON.stringify(HOME_CREATE_ID)})`,
  `~${HOME_CREATE_DESCRIPTION}`,
] as const;

export type CreationOption = {
  element: InstagramElement;
  selectors: string[];
  exactStory: boolean;
};

export function observedCreationOptions(elements: InstagramElement[]): CreationOption[] {
  const options: CreationOption[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    const labels = [element.text, element['content-desc']];
    if (!labels.some(value => /\b(story|stories|post|reel|reels|live)\b/i.test(value))) continue;
    // A descrição do botão da Home enumera todos os modos: não é uma opção Story.
    if (element['content-desc'] === HOME_CREATE_DESCRIPTION) continue;
    const selectors: string[] = [];
    if (element['resource-id']) selectors.push(`android=new UiSelector().resourceId(${JSON.stringify(element['resource-id'])})`);
    if (element['content-desc']) selectors.push(`~${element['content-desc']}`);
    if (element.text) selectors.push(`android=new UiSelector().text(${JSON.stringify(element.text)})`);
    const key = JSON.stringify(element);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ element, selectors, exactStory: labels.some(value => /^(story|stories)$/i.test(value.trim())) });
  }
  return options;
}
