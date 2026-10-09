import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fillStoryLinkUrl, resolveStoryUrl, DEFAULT_STORY_URL } from '../dist/instagram/storyLinkFill.js';
import { resourceIdSelector, STICKER_ITEM_ID } from '../dist/instagram/instagramStateMachine.js';
import { LINK_URL_ID, LINK_DONE_ID, LINK_EDITOR_MARKERS } from '../dist/instagram/linkEditorSelectors.js';
const original = process.env.DRY_RUN;
process.env.DRY_RUN = 'true';
after(() => { if (original === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = original; });

function fixture({ stickers = false, mismatch = false } = {}) {
  let panel = stickers;
  let value = 'https://old.example/';
  const actions = [];
  const field = {
    waitForExist: async () => assert.equal(panel, false), waitForDisplayed: async () => {}, isEnabled: async () => true,
    clearValue: async () => { actions.push('clear'); value = ''; },
    addValue: async input => { actions.push(['type', input]); value += input; },
    getText: async () => mismatch ? 'different' : value,
    click: () => { throw new Error('Não clicar no campo ou confirmar'); },
  };
  const done = { waitForExist: async () => {}, waitForDisplayed: async () => {}, click: () => { throw new Error('Done não pode ser clicado'); } };
  const items = Array.from({ length: 17 }, (_, index) => ({
    getAttribute: async name => name === 'content-desc' ? index === 7 ? 'Link Sticker' : 'Other' : STICKER_ITEM_ID,
    getText: async () => '', isDisplayed: async () => panel, isEnabled: async () => true,
    click: async () => { assert.equal(index, 7); actions.push('LINK'); panel = false; },
  }));
  const session = {
    $$: async selector => {
      if (LINK_EDITOR_MARKERS.some(id => resourceIdSelector(id) === selector)) return panel ? [] : [{}];
      if (selector === resourceIdSelector(STICKER_ITEM_ID)) return panel ? items : [];
      if (selector === '~Link Sticker') return panel ? [{}] : [];
      throw new Error(`Seletor inesperado ${selector}`);
    },
    $: async selector => {
      assert.ok(!selector.includes(STICKER_ITEM_ID), 'ID compartilhado nunca pode usar $');
      if (selector === resourceIdSelector(LINK_URL_ID)) return field;
      assert.equal(selector, resourceIdSelector(LINK_DONE_ID));
      return done;
    },
    getCurrentPackage: async () => 'com.instagram.android',
    waitUntil: async condition => { for (let i = 0; i < 2; i++) if (await condition()) return true; throw new Error('timeout'); },
  };
  return { session, actions };
}

test('editor aberto limpa conteúdo anterior e confirma URL variável sem clicar Done', async () => {
  const mock = fixture();
  const url = 'https://plantaorio.com.br/?id=123&source=poc';
  assert.equal(await fillStoryLinkUrl(mock.session, url), url);
  assert.deepEqual(mock.actions, ['clear', ['type', url]]);
});

test('painel com 17 itens clica somente LINK e preenche sem confirmar', async () => {
  const mock = fixture({ stickers: true });
  assert.equal(await fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL), DEFAULT_STORY_URL);
  assert.deepEqual(mock.actions, ['LINK', 'clear', ['type', DEFAULT_STORY_URL]]);
});

test('valor divergente falha e não confirma', async () => {
  const mock = fixture({ mismatch: true });
  await assert.rejects(fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL), /timeout/);
  assert.deepEqual(mock.actions, ['clear', ['type', DEFAULT_STORY_URL]]);
});

test('DRY_RUN falso impede limpar, preencher e clicar', async () => {
  const mock = fixture(); process.env.DRY_RUN = 'false';
  try { await assert.rejects(fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL), /DRY_RUN=true/); }
  finally { process.env.DRY_RUN = 'true'; }
  assert.deepEqual(mock.actions, []);
});

test('URL aceita parâmetro, variável e padrão sem normalizar valor', () => {
  assert.equal(resolveStoryUrl(), DEFAULT_STORY_URL);
  assert.equal(resolveStoryUrl(undefined, 'https://example.org'), 'https://example.org');
  assert.equal(resolveStoryUrl('https://example.net', 'https://example.org'), 'https://example.net');
  assert.throws(() => resolveStoryUrl('javascript:alert(1)'), /HTTP/);
  assert.throws(() => resolveStoryUrl(' https://example.org '), /HTTP/);
});
