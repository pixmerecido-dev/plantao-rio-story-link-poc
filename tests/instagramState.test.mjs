import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectInstagramState, reachStoryCreation, resourceIdSelector,
  HOME_CREATE_ID, HOME_TAB_ID, STORY_ID,
} from '../dist/instagram/storyFlowInspection.js';

function mockSession(ids, { storyVisible = true } = {}) {
  const existing = new Set(ids);
  const clicks = [];
  const waits = [];
  const session = {
    $: async selector => {
      const id = [HOME_CREATE_ID, HOME_TAB_ID, STORY_ID].find(value => resourceIdSelector(value) === selector);
      assert.ok(id, 'somente IDs confirmados podem ser consultados');
      return {
        isExisting: async () => existing.has(id),
        isDisplayed: async () => existing.has(id) && (id !== STORY_ID || storyVisible),
        isEnabled: async () => true,
        getAttribute: async name => { assert.equal(name, 'clickable'); return 'true'; },
        waitForExist: async () => { waits.push([id, 'exist']); assert.ok(existing.has(id), 'elemento ausente'); },
        waitForDisplayed: async () => { waits.push([id, 'displayed']); assert.ok(existing.has(id) && (id !== STORY_ID || storyVisible), 'elemento oculto'); },
        click: async () => {
          assert.notEqual(id, STORY_ID, 'não clicar em Story');
          clicks.push(id);
          if (id === HOME_TAB_ID) existing.add(HOME_CREATE_ID);
          if (id === HOME_CREATE_ID) existing.add(STORY_ID);
        },
      };
    },
    waitUntil: async condition => {
      for (let attempt = 0; attempt < 3; attempt++) if (await condition()) return true;
      throw new Error('timeout simulado');
    },
    getCurrentPackage: async () => 'com.instagram.android',
  };
  return { session, clicks, waits, existing };
}

test('CREATE prevalece sobre Home e não realiza cliques', async () => {
  const mock = mockSession([HOME_CREATE_ID, HOME_TAB_ID, STORY_ID]);
  assert.equal(await detectInstagramState(mock.session), 'STATE_CREATE');
  await reachStoryCreation(mock.session, 'STATE_CREATE');
  assert.deepEqual(mock.clicks, []);
  assert.deepEqual(mock.waits, [[STORY_ID, 'exist'], [STORY_ID, 'displayed']]);
});

test('HOME abre criação com um único clique e espera Story', async () => {
  const mock = mockSession([HOME_CREATE_ID, HOME_TAB_ID]);
  assert.equal(await detectInstagramState(mock.session), 'STATE_HOME');
  await reachStoryCreation(mock.session, 'STATE_HOME');
  assert.deepEqual(mock.clicks, [HOME_CREATE_ID]);
  assert.equal(await detectInstagramState(mock.session), 'STATE_CREATE');
});

test('UNKNOWN tenta Home quando a aba fica disponível e depois abre criação', async () => {
  const mock = mockSession([]);
  assert.equal(await detectInstagramState(mock.session), 'STATE_UNKNOWN');
  mock.existing.add(HOME_TAB_ID);
  await reachStoryCreation(mock.session, 'STATE_UNKNOWN');
  assert.deepEqual(mock.clicks, [HOME_TAB_ID, HOME_CREATE_ID]);
});

test('UNKNOWN sem aba Home falha sem clicar ou inventar navegação', async () => {
  const mock = mockSession([]);
  await assert.rejects(reachStoryCreation(mock.session, 'STATE_UNKNOWN'), /elemento ausente/);
  assert.deepEqual(mock.clicks, []);
});

test('Story existente mas oculto não confirma a tela', async () => {
  const mock = mockSession([STORY_ID], { storyVisible: false });
  await assert.rejects(reachStoryCreation(mock.session, 'STATE_CREATE'), /elemento oculto/);
  assert.deepEqual(mock.clicks, []);
});
