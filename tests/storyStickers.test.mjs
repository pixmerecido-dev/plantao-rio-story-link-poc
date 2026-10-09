import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { isStoryEditor, openStickersPanel, relevantStickerElements, linkStickerElements, STICKERS_SELECTORS, SHARE_SHORTCUT_ID } from '../dist/instagram/storyStickers.js';
import { resourceIdSelector } from '../dist/instagram/storyFlowInspection.js';

const originalDryRun = process.env.DRY_RUN;
process.env.DRY_RUN = 'true';
after(() => { if (originalDryRun === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = originalDryRun; });

function fixture({ primary = true, fallback = true, panelOpens = true, shareOnly = false } = {}) {
  let opened = false;
  const clicks = [];
  const session = {
    $: async selector => {
      const isButton = STICKERS_SELECTORS.includes(selector);
      const available = isButton ? !shareOnly && (selector === STICKERS_SELECTORS[0] ? primary : fallback)
        : selector === resourceIdSelector(SHARE_SHORTCUT_ID) ? shareOnly : opened;
      return {
        isExisting: async () => available,
        isDisplayed: async () => available,
        isEnabled: async () => available,
        getAttribute: async name => name === 'clickable' ? 'true' : 'Stickers',
        waitForExist: async () => assert.ok(available),
        waitForDisplayed: async () => assert.ok(available),
        click: async () => {
          assert.ok(isButton, 'Link, compartilhar e opções do painel nunca devem receber clique');
          clicks.push(selector);
          opened = panelOpens;
        },
      };
    },
    $$: async selector => (await (await session.$(selector)).isExisting()) ? [{}] : [],
    waitUntil: async condition => { for (let i = 0; i < 2; i++) if (await condition()) return true; throw new Error('timeout'); },
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => opened
      ? '<hierarchy><node text="LINK" resource-id="fixture:id/link" class="button"/><node text="Location" class="button"/></hierarchy>'
      : '<hierarchy><node content-desc="Stickers" resource-id="asset_button" class="button"/></hierarchy>',
  };
  return { session, clicks };
}

test('prefere asset_button, clica uma única vez e nunca em Link', async () => {
  const mock = fixture();
  assert.equal(await openStickersPanel(mock.session), STICKERS_SELECTORS[0]);
  assert.deepEqual(mock.clicks, [STICKERS_SELECTORS[0]]);
});

test('usa accessibility id Stickers quando resource-id não está disponível', async () => {
  const mock = fixture({ primary: false });
  assert.equal(await openStickersPanel(mock.session), STICKERS_SELECTORS[1]);
  assert.deepEqual(mock.clicks, [STICKERS_SELECTORS[1]]);
});

test('painel que não abre falha sem repetir clique', async () => {
  const mock = fixture({ panelOpens: false });
  await assert.rejects(openStickersPanel(mock.session), /timeout/);
  assert.deepEqual(mock.clicks, [STICKERS_SELECTORS[0]]);
});

test('marcador Your story confirma editor mas nunca é clicado', async () => {
  const mock = fixture({ shareOnly: true });
  assert.equal(await isStoryEditor(mock.session), true);
  await assert.rejects(openStickersPanel(mock.session), /timeout/);
  assert.deepEqual(mock.clicks, []);
});

test('lista atributos reais, deduplica e distingue LINK exato de termos relacionados', () => {
  const element = text => ({ text, 'content-desc': '', 'resource-id': '', class: 'fixture' });
  const nodes = [element('LINK'), element('LINK'), element('Link account'), element('Location'), element('Mention'), element('GIF'), element('Poll'), element('Music'), element('Hashtag'), element('Share')];
  assert.equal(relevantStickerElements(nodes).length, 8);
  assert.deepEqual(linkStickerElements(nodes), [element('LINK')]);
});
