import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { clickExactLinkSticker, inspectLinkEditorElements, waitForLinkEditor, LINK_ITEM_SELECTOR } from '../dist/instagram/storyLinkInspection.js';
import { STICKER_ITEM_ID, resourceIdSelector } from '../dist/instagram/instagramStateMachine.js';
const originalDryRun = process.env.DRY_RUN;
process.env.DRY_RUN = 'true';
after(() => { if (originalDryRun === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = originalDryRun; });

function fixture(descriptions, { transition = true } = {}) {
  const clicks = [];
  let panel = true;
  const items = descriptions.map(description => ({
    isDisplayed: async () => panel,
    isEnabled: async () => true,
    getText: async () => '',
    getAttribute: async name => name === 'content-desc' ? description : STICKER_ITEM_ID,
    waitForExist: async () => { throw new Error('StrictSelectorError: não esperar item por selector compartilhado'); },
    waitForDisplayed: async () => { throw new Error('StrictSelectorError: não esperar item por selector compartilhado'); },
    click: async () => { assert.equal(description, 'Link Sticker'); clicks.push(description); if (transition) panel = false; },
  }));
  const session = {
    $: async selector => {
      assert.ok(!selector.includes(STICKER_ITEM_ID), 'StrictSelectorError: nenhum seletor desse ID pode usar $');
      return { isExisting: async () => false, isDisplayed: async () => false };
    },
    $$: async selector => {
      if (!panel) return [];
      if (selector === resourceIdSelector(STICKER_ITEM_ID)) return items;
      if (selector === '~Link Sticker') return [{ isDisplayed: async () => panel }];
      assert.equal(selector, LINK_ITEM_SELECTOR);
      const matches = [];
      for (const item of items) if (await item.getAttribute('content-desc') === 'Link Sticker') matches.push(item);
      return matches;
    },
    getCurrentPackage: async () => 'com.instagram.android',
    waitUntil: async condition => { for (let i = 0; i < 2; i++) if (await condition()) return true; throw new Error('timeout'); },
    getPageSource: async () => panel ? '<hierarchy><node content-desc="Link Sticker" resource-id="com.instagram.android:id/sticker_sheet_redesign_item"/></hierarchy>'
      : '<hierarchy><node text="URL" resource-id="fixture:id/input" class="android.widget.EditText"/><node text="Done" class="android.widget.Button"/></hierarchy>',
  };
  return { session, clicks };
}

test('ID compartilhado: clica somente no item de descrição exata Link Sticker', async () => {
  const mock = fixture(['Location', 'Link Sticker', 'Music']);
  const before = await mock.session.getPageSource();
  assert.equal(await clickExactLinkSticker(mock.session), LINK_ITEM_SELECTOR);
  assert.deepEqual(mock.clicks, ['Link Sticker']);
  await waitForLinkEditor(mock.session, before);
});

test('dois Link Sticker recusam ambiguidade sem clique', async () => {
  const mock = fixture(['Link Sticker', 'Link Sticker']);
  await assert.rejects(clickExactLinkSticker(mock.session), /encontrados 2/);
  assert.deepEqual(mock.clicks, []);
});

test('não escolhe primeiro item quando LINK está ausente ou tem descrição diferente', async () => {
  const mock = fixture(['Location', 'link sticker', 'Music']);
  await assert.rejects(clickExactLinkSticker(mock.session), /encontrados 0/);
  assert.deepEqual(mock.clicks, []);
});

test('coleção vazia falha antes de selecionar um item', async () => {
  const mock = fixture([]);
  await assert.rejects(clickExactLinkSticker(mock.session), /Nenhum item/);
  assert.deepEqual(mock.clicks, []);
});

test('tela que permanece no painel falha sem segundo clique', async () => {
  const mock = fixture(['Link Sticker'], { transition: false });
  const before = await mock.session.getPageSource();
  await clickExactLinkSticker(mock.session);
  await assert.rejects(waitForLinkEditor(mock.session, before), /timeout/);
  assert.deepEqual(mock.clicks, ['Link Sticker']);
});

test('identifica apenas candidatos observados, sem assumir URL por classe isolada', () => {
  const element = (text, cls) => ({ text, 'content-desc': '', 'resource-id': '', class: cls });
  const input = element('Web address', 'android.widget.EditText');
  const done = element('Done', 'android.widget.Button');
  const result = inspectLinkEditorElements([input, done, element('', 'android.widget.EditText'), element('Customize sticker text', 'android.widget.TextView')]);
  assert.deepEqual(result.urlFields, [input]);
  assert.deepEqual(result.confirmations, [done]);
  assert.equal(result.relevant.length, 3);
});

test('DRY_RUN diferente de true impede qualquer clique', async () => {
  const mock = fixture(['Link Sticker']);
  process.env.DRY_RUN = 'false';
  try { await assert.rejects(clickExactLinkSticker(mock.session), /DRY_RUN=true/); }
  finally { process.env.DRY_RUN = 'true'; }
  assert.deepEqual(mock.clicks, []);
});


test('17 itens compartilhados selecionam apenas LINK no meio da coleção sem seleção estrita', async () => {
  const descriptions = Array.from({ length: 17 }, (_, index) => index === 9 ? 'Link Sticker' : `Sticker ${index}`);
  const mock = fixture(descriptions);
  await clickExactLinkSticker(mock.session);
  assert.deepEqual(mock.clicks, ['Link Sticker']);
});
