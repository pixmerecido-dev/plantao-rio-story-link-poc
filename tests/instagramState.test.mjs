import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { detectInstagramState, navigateToStoryEditor, resourceIdSelector,
  HOME_CREATE_ID, HOME_TAB_ID, STORY_ID, GALLERY_ID, STICKERS_ID, SHARE_SHORTCUT_ID, STICKER_ITEM_ID, LINK_STICKER_DESCRIPTION } from '../dist/instagram/instagramStateMachine.js';
import { reachStoryCreation } from '../dist/instagram/storyFlowInspection.js';

const originalDryRun = process.env.DRY_RUN;
process.env.DRY_RUN = 'true';
after(() => { if (originalDryRun === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = originalDryRun; });

function mockSession(ids, { hidden = [] } = {}) {
  const existing = new Set(ids);
  const clicks = [], waits = [], probes = [];
  const selectors = new Map([HOME_CREATE_ID, HOME_TAB_ID, STORY_ID, GALLERY_ID, STICKERS_ID, SHARE_SHORTCUT_ID, STICKER_ITEM_ID].map(id => [resourceIdSelector(id), id]));
  selectors.set('~Stickers', 'description:Stickers');
  selectors.set(`~${LINK_STICKER_DESCRIPTION}`, 'description:Link Sticker');
  const session = {
    $$: async selector => {
      const id = selectors.get(selector);
      assert.ok([STICKER_ITEM_ID, 'description:Link Sticker'].includes(id));
      probes.push(id);
      return existing.has(id) ? [{}] : [];
    },
    $: async selector => {
      assert.notEqual(selector, resourceIdSelector(STICKER_ITEM_ID), 'ID compartilhado nunca pode usar seleção única');
      const id = selectors.get(selector);
      assert.ok(id, 'somente seletores confirmados podem ser consultados');
      probes.push(id);
      return {
        isExisting: async () => existing.has(id),
        isDisplayed: async () => existing.has(id) && !hidden.includes(id),
        isEnabled: async () => true,
        getAttribute: async name => { assert.equal(name, 'clickable'); return 'true'; },
        waitForExist: async () => { waits.push([id, 'exist']); assert.ok(existing.has(id), 'elemento ausente'); },
        waitForDisplayed: async () => { waits.push([id, 'displayed']); assert.ok(existing.has(id) && !hidden.includes(id), 'elemento oculto'); },
        click: async () => {
          assert.ok([HOME_CREATE_ID, STORY_ID].includes(id), 'nunca clicar em feed_tab, Stickers ou compartilhar');
          clicks.push(id);
          if (id === HOME_CREATE_ID) existing.add(STORY_ID);
          if (id === STORY_ID) existing.add(GALLERY_ID);
        },
      };
    },
    waitUntil: async condition => { for (let attempt = 0; attempt < 3; attempt++) if (await condition()) return true; throw new Error('timeout simulado'); },
    getCurrentPackage: async () => 'com.instagram.android',
  };
  let selections = 0;
  const selectImage = async () => { selections++; existing.delete(GALLERY_ID); existing.add(STICKERS_ID); };
  return { session, clicks, waits, probes, existing, selectImage, selections: () => selections };
}

test('EDITOR prevalece e retorna sem Home, ADB/seleção ou esperas', async () => {
  const mock = mockSession([HOME_TAB_ID, STORY_ID, GALLERY_ID, STICKERS_ID]);
  const result = await navigateToStoryEditor(mock.session, mock.selectImage);
  assert.equal(result.initialState, 'STATE_EDITOR');
  assert.deepEqual(mock.clicks, []);
  assert.equal(mock.selections(), 0);
  assert.deepEqual(mock.waits, []);
  assert.deepEqual(mock.probes, [STICKER_ITEM_ID, 'description:Link Sticker', STICKERS_ID]);
});

test('GALERIA prevalece sobre CREATE/HOME e só seleciona uma imagem', async () => {
  const mock = mockSession([HOME_TAB_ID, STORY_ID, GALLERY_ID]);
  const result = await navigateToStoryEditor(mock.session, mock.selectImage);
  assert.equal(result.initialState, 'STATE_GALLERY');
  assert.equal(result.finalState, 'STATE_EDITOR');
  assert.equal(mock.selections(), 1);
  assert.deepEqual(mock.clicks, []);
});

test('CREATE retoma sem Home, com um clique em STORY e uma seleção', async () => {
  const mock = mockSession([STORY_ID, HOME_TAB_ID]);
  await navigateToStoryEditor(mock.session, mock.selectImage);
  assert.deepEqual(mock.clicks, [STORY_ID]);
  assert.equal(mock.selections(), 1);
});

test('HOME percorre CREATE e GALERIA, sem clicar em feed_tab', async () => {
  const mock = mockSession([HOME_CREATE_ID, HOME_TAB_ID]);
  const result = await navigateToStoryEditor(mock.session, mock.selectImage);
  assert.deepEqual(mock.clicks, [HOME_CREATE_ID, STORY_ID]);
  assert.equal(mock.selections(), 1);
  assert.equal(result.finalState, 'STATE_EDITOR');
});

test('UNKNOWN aborta imediatamente sem qualquer waitForExist ou clique', async () => {
  const mock = mockSession([]);
  assert.equal(await detectInstagramState(mock.session), 'STATE_UNKNOWN');
  await assert.rejects(navigateToStoryEditor(mock.session, mock.selectImage), /STATE_UNKNOWN/);
  assert.deepEqual(mock.waits, []);
  assert.deepEqual(mock.clicks, []);
  assert.equal(mock.selections(), 0);
});

test('marcadores ocultos não desviam a detecção da galeria visível', async () => {
  const mock = mockSession([STICKERS_ID, STORY_ID, GALLERY_ID], { hidden: [STICKERS_ID, STORY_ID] });
  assert.equal(await detectInstagramState(mock.session), 'STATE_GALLERY');
  assert.deepEqual(mock.waits, []);
});

test('ausência de elemento é ignorada, mas erro de conexão não é ocultado', async () => {
  const missing = { $$: async () => [], $: async () => { throw new Error('no such element'); } };
  assert.equal(await detectInstagramState(missing), 'STATE_UNKNOWN');
  await assert.rejects(detectInstagramState({ $$: async () => { throw new Error('connection refused'); } }), /connection refused/);
});

test('share shortcut e descrição Stickers são marcadores só de leitura', async () => {
  for (const id of [SHARE_SHORTCUT_ID, 'description:Stickers']) {
    const mock = mockSession([id]);
    assert.equal(await detectInstagramState(mock.session), 'STATE_EDITOR');
    await navigateToStoryEditor(mock.session, mock.selectImage);
    assert.deepEqual(mock.clicks, []);
  }
});

test('falha na seleção não repete clique nem seleciona outra mídia', async () => {
  const mock = mockSession([GALLERY_ID]);
  let calls = 0;
  await assert.rejects(navigateToStoryEditor(mock.session, async () => { calls++; throw new Error('falha de mídia'); }), /falha de mídia/);
  assert.equal(calls, 1);
  assert.deepEqual(mock.clicks, []);
});

test('inspeção de criação continua sem clicar em STORY', async () => {
  const mock = mockSession([STORY_ID]);
  await reachStoryCreation(mock.session, 'STATE_CREATE');
  assert.deepEqual(mock.clicks, []);
});


test('STICKERS prevalece sobre editor e nunca dispara seleção de imagem', async () => {
  for (const marker of [STICKER_ITEM_ID, 'description:Link Sticker']) {
    const mock = mockSession([marker, STICKERS_ID, SHARE_SHORTCUT_ID]);
    assert.equal(await detectInstagramState(mock.session), 'STATE_STICKERS');
    await assert.rejects(navigateToStoryEditor(mock.session, mock.selectImage), /painel já aberto/);
    assert.deepEqual(mock.clicks, []);
    assert.equal(mock.selections(), 0);
    assert.deepEqual(mock.waits, []);
  }
});


test('existência do item compartilhado reconhece Stickers sem espera longa', async () => {
  const mock = mockSession([STICKER_ITEM_ID], { hidden: [STICKER_ITEM_ID] });
  assert.equal(await detectInstagramState(mock.session), 'STATE_STICKERS');
  assert.deepEqual(mock.waits, []);
});
