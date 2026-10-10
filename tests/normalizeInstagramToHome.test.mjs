import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { normalizeInstagramToHome, inspectResetScreen } from '../dist/instagram/normalizeInstagramToHome.js';
import { prepareNewStory } from '../dist/instagram/storyPrepare.js';
import { LINK_STICKER_HOLDER_ID, SHARE_SHORTCUT_ID, STICKER_ITEM_ID } from '../dist/instagram/instagramStateMachine.js';
import { LINK_URL_ID } from '../dist/instagram/linkEditorSelectors.js';
const draft = '<hierarchy><node class="android.app.Dialog"><node text="Discard edits?"/><node text="Save draft"/><node text="Discard" resource-id="fixture:id/discard_draft" class="android.widget.Button"/></node></hierarchy>';
const unsafe = '<hierarchy><node class="android.app.Dialog"><node text="Delete published story?"/><node text="Discard" resource-id="fixture:id/discard_draft"/></node></hierarchy>';
const share = '<hierarchy><node text="Share to"/><node text="Your story"/><node text="Close Friends"/></hierarchy>';
function fixture(sequence, { stuck = false, drift = false } = {}) {
  let step = 0, backs = 0, clicks = 0, homeWaits = 0;
  const state = () => sequence[Math.min(step, sequence.length - 1)];
  const ids = () => ({ STATE_HOME: ['com.instagram.android:id/feed_tab'], STATE_CREATE: ['com.instagram.android:id/cam_dest_story'], STATE_GALLERY: ['com.instagram.android:id/gallery_grid_container'], STATE_EDITOR: ['asset_button'], STATE_EDITOR_WITH_LINK: ['asset_button', LINK_STICKER_HOLDER_ID, SHARE_SHORTCUT_ID], STATE_STICKERS: [STICKER_ITEM_ID], STATE_LINK_EDITOR: [LINK_URL_ID] }[state()] ?? []);
  const element = id => ({ elementId: id, isExisting: async () => ids().includes(id), isDisplayed: async () => ids().includes(id), isEnabled: async () => true });
  const session = {
    $: async selector => element(selector.match(/resourceId\("([^"]+)"\)/)?.[1]),
    $$: async selector => {
      if (selector.includes('discard_draft') && state() === 'DIALOG') return [{ elementId: 'discard-draft-only', isDisplayed: async () => true, isEnabled: async () => true, getAttribute: async name => { assert.equal(name, 'clickable'); return 'true'; } }];
      const id = selector.match(/resourceId\("([^"]+)"\)/)?.[1]; return ids().includes(id) ? [element(id)] : [];
    },
    getPageSource: async () => state() === 'DIALOG' ? draft : state() === 'UNSAFE' ? unsafe : state() === 'SHARE' ? share : '<hierarchy/>',
    getCurrentPackage: async () => 'com.instagram.android',
    back: async () => { backs++; if (!stuck) step++; },
    elementClick: async id => { assert.equal(id, 'discard-draft-only'); assert.equal(state(), 'DIALOG'); clicks++; step++; },
    pause: async milliseconds => { if (milliseconds === 500) { homeWaits++; if (drift) step++; } },
    saveScreenshot: async path => writeFile(path, 'fixture'),
  };
  return { driver: { getSession: () => session }, counts: () => ({ backs, clicks, homeWaits }) };
}
for (const initial of ['STATE_HOME', 'STATE_CREATE', 'STATE_GALLERY', 'STATE_EDITOR', 'STATE_EDITOR_WITH_LINK', 'STATE_STICKERS', 'STATE_LINK_EDITOR', 'SHARE']) {
  test(`normaliza ${initial} sem modificar conta ou publicar`, async () => {
    const mock = fixture(initial === 'STATE_HOME' ? [initial] : [initial, 'STATE_HOME']);
    await normalizeInstagramToHome(mock.driver, await mkdtemp('/tmp/normalize-'));
    assert.deepEqual(mock.counts(), { backs: initial === 'STATE_HOME' ? 0 : 1, clicks: 0, homeWaits: 1 });
  });
}
test('painéis residuais e diálogo explícito de draft local chegam à Home', async () => {
  const mock = fixture(['STATE_LINK_EDITOR', 'STATE_STICKERS', 'STATE_EDITOR_WITH_LINK', 'DIALOG', 'STATE_HOME']);
  await normalizeInstagramToHome(mock.driver, await mkdtemp('/tmp/normalize-draft-'));
  assert.deepEqual(mock.counts(), { backs: 3, clicks: 1, homeWaits: 1 });
});
test('estado que não sai limita Back a cinco chamadas', async () => {
  const mock = fixture(['STATE_EDITOR'], { stuck: true });
  await assert.rejects(normalizeInstagramToHome(mock.driver, await mkdtemp('/tmp/normalize-limit-')), /cinco retornos/);
  assert.equal(mock.counts().backs, 5); assert.equal(mock.counts().clicks, 0);
});
for (const initial of ['STATE_UNKNOWN', 'UNSAFE']) {
  test(`tela ou diálogo não comprovado aborta: ${initial}`, async () => {
    const mock = fixture([initial]);
    await assert.rejects(normalizeInstagramToHome(mock.driver, await mkdtemp('/tmp/normalize-unknown-')), /desconhecido ou ambíguo/);
    assert.deepEqual(mock.counts(), { backs: 0, clicks: 0, homeWaits: 0 });
  });
}
test('Home que muda durante estabilização aborta', async () => {
  const mock = fixture(['STATE_HOME', 'STATE_EDITOR'], { drift: true });
  await assert.rejects(normalizeInstagramToHome(mock.driver, await mkdtemp('/tmp/normalize-drift-')), /não estabilizou/);
});
test('labels fora do diálogo e descarte genérico não autorizam excluir conteúdo', () => {
  assert.equal(inspectResetScreen('<hierarchy><node text="Save draft"/><node class="android.app.Dialog"><node text="Discard"/></node></hierarchy>').state, 'STATE_UNSAFE_DIALOG');
  assert.equal(inspectResetScreen(unsafe).state, 'STATE_UNSAFE_DIALOG');
  assert.equal(inspectResetScreen(draft.replace('Save draft', 'Something else')).state, 'STATE_UNSAFE_DIALOG');
});
test('falha na normalização impede callback do novo job', async () => {
  const previous = process.env.DRY_RUN; process.env.DRY_RUN = 'true';
  try {
    const mock = fixture(['UNSAFE']); let newImageCalls = 0;
    const job = { job_id: 'job', image: 'file.jpg', story_url: 'https://example.org', sticker_text: 'Texto', publish_instagram: false, publish_facebook: false };
    await assert.rejects(prepareNewStory(mock.driver, job, await mkdtemp('/tmp/normalize-job-'), async () => { newImageCalls++; }));
    assert.equal(newImageCalls, 0);
  } finally { if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous; }
});

test('diálogo desconhecido não é confundido com Share da tela atrás', () => {
  const source = share.replace('</hierarchy>', '<node class="android.app.Dialog"><node text="Unknown prompt"/></node></hierarchy>');
  assert.equal(inspectResetScreen(source).state, 'STATE_UNSAFE_DIALOG');
});
test('dois controles Discard não autorizam escolha por índice', () => {
  const source = draft.replace('</node></hierarchy>', '<node text="Discard" resource-id="fixture:id/other"/></node></hierarchy>');
  assert.equal(inspectResetScreen(source).state, 'STATE_UNSAFE_DIALOG');
});
