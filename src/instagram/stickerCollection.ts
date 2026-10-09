import type { InstagramDriver } from './InstagramDriver.js';

type CollectionSession = Pick<ReturnType<InstagramDriver['getSession']>, '$$'>;
export const STICKER_ITEM_ID = 'com.instagram.android:id/sticker_sheet_redesign_item';
export const LINK_STICKER_DESCRIPTION = 'Link Sticker';
export const STICKER_ITEMS_SELECTOR = `android=new UiSelector().resourceId(${JSON.stringify(STICKER_ITEM_ID)})`;

/** Limite explícito: esta função não recebe $, findStrictElement ou esperas individuais. */
export async function getStickerItems(session: CollectionSession) {
  return await session.$$(STICKER_ITEMS_SELECTOR);
}

export async function hasStickerPanel(session: CollectionSession): Promise<boolean> {
  for (const selector of [STICKER_ITEMS_SELECTOR, `~${LINK_STICKER_DESCRIPTION}`]) {
    try {
      const items = selector === STICKER_ITEMS_SELECTOR ? await getStickerItems(session) : await session.$$(selector);
      if (items.length > 0) return true;
    } catch (error: unknown) {
      if (!(error instanceof Error) || !/no such element|stale element reference/i.test(error.message)) throw error;
    }
  }
  return false;
}
