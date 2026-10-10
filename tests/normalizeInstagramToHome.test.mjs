import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { normalizeInstagramToHome, inspectResetScreen, analyzeResetHierarchy } from '../dist/instagram/normalizeInstagramToHome.js';
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
    getPageSource: async () => state() === 'DIALOG' ? draft : state() === 'UNSAFE' ? unsafe : state() === 'SHARE' ? share : state() === 'STATE_HOME' ? '<hierarchy><node text="For you"/><node resource-id="com.instagram.android:id/reel_empty_badge" content-desc="Add to story" class="android.widget.Button"/></hierarchy>' : `<hierarchy>${ids().map(id => `<node resource-id="${id}"/>`).join('')}</hierarchy>`,
    getCurrentPackage: async () => 'com.instagram.android',
    back: async () => { backs++; if (!stuck) step++; },
    elementClick: async id => { assert.equal(id, 'discard-draft-only'); assert.equal(state(), 'DIALOG'); clicks++; step++; },
    pause: async milliseconds => { if (milliseconds === 2000) { homeWaits++; if (drift) step++; } },
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
test('Home que muda durante estabilização continua até o limite, sem confirmar Home', async () => {
  const mock = fixture(['STATE_HOME', 'STATE_EDITOR'], { drift: true });
  await assert.rejects(normalizeInstagramToHome(mock.driver, await mkdtemp('/tmp/normalize-drift-')), /cinco retornos/);
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

const homeXML = '<node text="For you"/><node content-desc="Add to story" resource-id="com.instagram.android:id/reel_empty_badge" class="android.widget.Button"/>';
test('tabs persistentes sozinhas nunca confirmam Home', () => {
  assert.equal(analyzeResetHierarchy('<hierarchy><node resource-id="com.instagram.android:id/feed_tab"/><node resource-id="com.instagram.android:id/profile_tab"/></hierarchy>').state, 'STATE_UNKNOWN');
});
for (const signal of ['<node resource-id="asset_button"/>', '<node content-desc="Your story" class="android.widget.Button"/>', '<node text="Close Friends"/>', '<node content-desc="Stickers"/>', '<node content-desc="Music"/>', '<node text="Aa" class="android.widget.Button"/>', '<node resource-id="com.instagram.android:id/story_share_controls_action_bar"/>', '<node resource-id="com.instagram.android:id/gallery_grid_container"/>']) {
  test(`sinal de editor bloqueia Home mesmo com dois sinais e feed_tab: ${signal}`, () => {
    const result = analyzeResetHierarchy(`<hierarchy>${homeXML}<node resource-id="com.instagram.android:id/feed_tab"/>${signal}</hierarchy>`);
    assert.notEqual(result.state, 'STATE_HOME'); assert.ok(result.blockers.length > 0);
  });
}
test('Link Editor e Stickers precedem controles de Share e Home', () => {
  const result = analyzeResetHierarchy(`<hierarchy>${homeXML}<node resource-id="${LINK_URL_ID}"/>${share.replace(/<\/?hierarchy>/g, '')}<node resource-id="${STICKER_ITEM_ID}"/></hierarchy>`);
  assert.equal(result.state, 'STATE_LINK_EDITOR');
});
test('thumbnail Your story da Home não é confundida com botão de publicação', () => {
  assert.equal(analyzeResetHierarchy(`<hierarchy>${homeXML}<node text="Your story" resource-id="com.instagram.android:id/username" class="android.widget.TextView"/></hierarchy>`).state, 'STATE_HOME');
});

test('mudança após Home não estabilizada continua e confirma Home novamente antes de terminar', async () => {
  const mock = fixture(['STATE_HOME', 'STATE_EDITOR', 'STATE_HOME'], { drift: true });
  const dir = await mkdtemp('/tmp/reset-recovery-');
  await normalizeInstagramToHome(mock.driver, dir);
  assert.equal(mock.counts().backs, 1);
  assert.equal(mock.counts().homeWaits, 2);
  const files = await readdir(dir);
  for (const base of ['reset-before', 'reset-step-1', 'reset-final']) for (const extension of ['xml', 'png', 'json']) assert.ok(files.includes(`${base}.${extension}`));
});
test('sinais de Home ocultos não contam como confirmação', () => {
  assert.notEqual(analyzeResetHierarchy(`<hierarchy><node displayed="false">${homeXML}</node></hierarchy>`).state, 'STATE_HOME');
});
