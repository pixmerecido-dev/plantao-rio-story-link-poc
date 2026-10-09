import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { isStoryEditor, openStickersPanel, relevantStickerElements, linkStickerElements, STICKERS_SELECTORS, SHARE_SHORTCUT_ID } from '../dist/instagram/storyStickers.js';
import { resourceIdSelector } from '../dist/instagram/storyFlowInspection.js';

const originalDryRun = process.env.DRY_RUN;
process.env.DRY_RUN = 'true';
after(() => { if (originalDryRun === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = originalDryRun; });

function fixture({ primary = true, fallback = true, panelOpens = true, shareOnly = false, primaryDescription = 'Stickers', clickable = true } = {}) {
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
        getAttribute: async name => name === 'clickable' ? String(clickable) : selector === STICKERS_SELECTORS[0] ? primaryDescription : 'Stickers',
        waitForExist: async () => { if (!available) throw new Error('timeout: elemento ausente'); },
        waitForDisplayed: async () => { if (!available) throw new Error('timeout: elemento não visível'); },
        click: async () => {
          assert.ok(isButton, 'Link, compartilhar e opções do painel nunca devem receber clique');
          clicks.push(selector);
          opened = panelOpens;
        },
      };
    },
    $$: async selector => selector.includes('link_sticker_list_') ? [] : (await (await session.$(selector)).isExisting()) ? [{}] : [],
    waitUntil: async condition => { for (let i = 0; i < 2; i++) if (await condition()) return true; throw new Error('timeout'); },
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => opened
      ? '<hierarchy><node text="LINK" resource-id="fixture:id/link" class="button"/><node text="Location" class="button"/></hierarchy>'
      : `<hierarchy><node resource-id="asset_button" class="button"/><node content-desc="Stickers" class="label"/></hierarchy>`,
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


test('asset_button sem descrição no mesmo nó aceita Stickers em elemento separado', async () => {
  const mock = fixture({ primaryDescription: null });
  assert.equal(await openStickersPanel(mock.session), STICKERS_SELECTORS[0]);
  assert.deepEqual(mock.clicks, [STICKERS_SELECTORS[0]]);
});

test('asset_button continua válido sem descrição Stickers em qualquer nó', async () => {
  const mock = fixture({ primaryDescription: '', fallback: false });
  assert.equal(await openStickersPanel(mock.session), STICKERS_SELECTORS[0]);
  assert.deepEqual(mock.clicks, [STICKERS_SELECTORS[0]]);
});

test('asset_button presente mas não clicável não usa fallback nem clica', async () => {
  const mock = fixture({ clickable: false });
  await assert.rejects(openStickersPanel(mock.session), /timeout/);
  assert.deepEqual(mock.clicks, []);
});

test('Website e URL entram no diagnóstico sem serem classificados como LINK exato', () => {
  const element = text => ({ text, 'content-desc': '', 'resource-id': '', class: 'fixture' });
  const nodes = [element('Website'), element('URL'), element('Add URL'), element('LINK')];
  assert.equal(relevantStickerElements(nodes).length, 4);
  assert.deepEqual(linkStickerElements(nodes), [element('LINK')]);
});


test('diagnóstico reconhece a descrição real Link Sticker', () => {
  const link = { text: '', 'content-desc': 'Link Sticker', 'resource-id': 'com.instagram.android:id/sticker_sheet_redesign_item', class: 'android.view.ViewGroup' };
  assert.deepEqual(linkStickerElements([link]), [link]);
});
