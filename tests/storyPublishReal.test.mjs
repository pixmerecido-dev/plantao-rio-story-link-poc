import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { assertRealPublishAllowed, publishStoryOnce } from '../dist/instagram/storyPublishReal.js';
import { resourceIdSelector, SHARE_SHORTCUT_ID, LINK_STICKER_HOLDER_ID } from '../dist/instagram/instagramStateMachine.js';
const previous = { allow: process.env.ALLOW_PUBLISH, confirm: process.env.CONFIRM_REAL_PUBLISH };
after(() => {
  for (const [name, value] of [['ALLOW_PUBLISH', previous.allow], ['CONFIRM_REAL_PUBLISH', previous.confirm]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
function clock() { let time = 0; return { now: () => time, pause: async ms => { time += ms; } }; }
const authorize = () => { process.env.ALLOW_PUBLISH = 'true'; process.env.CONFIRM_REAL_PUBLISH = 'YES'; };
function fixture({ target = 'STATE_HOME', clickable = 'true', enabled = true, ambiguous = false, clickThrows = false, revoke = false, holder = true, failure = false } = {}) {
  let clicked = false;
  let count = 0;
  const button = {
    elementId: 'share-real-id',
    isExisting: async () => !clicked, isDisplayed: async () => !clicked, isEnabled: async () => enabled,
    getAttribute: async name => ({ clickable, 'resource-id': SHARE_SHORTCUT_ID, 'content-desc': 'Your story', class: 'android.widget.Button' })[name],
    click: async () => { count++; assert.equal(count, 1); clicked = true; if (clickThrows) throw new Error('click transport timeout'); },
  };
  const visible = { isExisting: async () => true, isDisplayed: async () => true };
  const session = {
    elementClick: async id => { assert.equal(id, button.elementId); await button.click(); },
    $: async selector => ({ isExisting: async () => (!clicked || target === 'STATE_EDITOR_WITH_LINK') && selector === resourceIdSelector('asset_button') || clicked && target === 'STATE_HOME' && selector === resourceIdSelector('com.instagram.android:id/feed_tab'), isDisplayed: async () => true }),
    $$: async selector => {
      if (clicked && target !== 'STATE_EDITOR_WITH_LINK') return [];
      if (selector === resourceIdSelector(LINK_STICKER_HOLDER_ID)) return holder ? [visible] : [];
      if (selector === resourceIdSelector(SHARE_SHORTCUT_ID)) return ambiguous ? [button, button] : [button];
      return [];
    },
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => `<hierarchy><node text="${clicked ? failure ? 'Failed to upload' : 'after' : 'before'}"/></hierarchy>`,
    saveScreenshot: async path => { await writeFile(path, 'fixture'); if (revoke && path.includes('pre-publish')) process.env.CONFIRM_REAL_PUBLISH = 'NO'; },
    waitUntil: async callback => { for (let i = 0; i < 2; i++) if (await callback()) return; throw new Error('timeout'); },
  };
  return { driver: { getSession: () => session }, count: () => count };
}
for (const [allow, confirm] of [[undefined, undefined], ['true', undefined], [undefined, 'YES'], ['false', 'YES'], ['true', 'yes'], ['TRUE', 'YES'], ['true', ' YES ']]) {
  test(`dupla trava bloqueia ${allow}/${confirm} antes de acessar sessão`, async () => {
    if (allow === undefined) delete process.env.ALLOW_PUBLISH; else process.env.ALLOW_PUBLISH = allow;
    if (confirm === undefined) delete process.env.CONFIRM_REAL_PUBLISH; else process.env.CONFIRM_REAL_PUBLISH = confirm;
    assert.throws(assertRealPublishAllowed, /exige/);
    await assert.rejects(publishStoryOnce({ getSession: () => { throw new Error('não deve conectar'); } }, '/tmp/unused'), /exige/);
  });
}
test('publicação autorizada faz um clique e salva antes e depois', async () => {
  authorize(); const mock = fixture(); const dir = await mkdtemp('/tmp/publish-real-');
  const result = await publishStoryOnce(mock.driver, dir, clock());
  assert.equal(mock.count(), 1); assert.equal(result.outcome, 'INCONCLUSIVE'); assert.equal(result.retryAllowed, false);
  assert.match(result.job_id, /^[0-9a-f-]{36}$/); assert.ok(result.media_id.startsWith(result.job_id));
  assert.equal(result.media_identity_source, 'editor-hierarchy-snapshot');
  assert.ok(result.observations.some(item => item.elapsed_ms >= 15000));
  const pending = JSON.parse(await readFile(`${dir}/pending-publication.json`, 'utf8'));
  assert.equal(pending.status, 'PUBLISH_PENDING_CONFIRMATION');
  assert.equal(pending.job_id, result.job_id);
  for (const name of ['pre-publish', 'immediate-post-click', 'post-publish-5s', 'post-publish-10s', 'post-publish-15s']) for (const ext of ['xml', 'png', 'json']) assert.ok((await readdir(dir)).includes(`${name}.${ext}`));
});
for (const options of [{ clickable: 'false' }, { enabled: false }, { ambiguous: true }, { holder: false }]) {
  test(`editor ou botão inválido cancela sem clique: ${JSON.stringify(options)}`, async () => {
    authorize(); const mock = fixture(options);
    await assert.rejects(publishStoryOnce(mock.driver, await mkdtemp('/tmp/publish-invalid-'), clock()));
    assert.equal(mock.count(), 0);
  });
}
for (const options of [{ target: 'STATE_EDITOR_WITH_LINK' }, { target: 'STATE_UNKNOWN' }, { clickThrows: true, target: 'STATE_EDITOR_WITH_LINK' }]) {
  test(`incerteza pós-clique nunca repete publicação: ${JSON.stringify(options)}`, async () => {
    authorize(); const mock = fixture(options); const dir = await mkdtemp('/tmp/publish-timeout-');
    const result = await publishStoryOnce(mock.driver, dir, clock());
    assert.equal(result.outcome, 'INCONCLUSIVE'); assert.equal(mock.count(), 1);
    assert.ok((await readdir(dir)).includes('post-publish-15s.xml'));
  });
}
test('revogação da trava durante captura impede clique', async () => {
  authorize(); const mock = fixture({ revoke: true });
  await assert.rejects(publishStoryOnce(mock.driver, await mkdtemp('/tmp/publish-revoke-'), clock()), /exige/);
  assert.equal(mock.count(), 0);
});
test('falha de envio observada não provoca outro clique', async () => {
  authorize(); const mock = fixture({ failure: true });
  const result = await publishStoryOnce(mock.driver, await mkdtemp('/tmp/publish-fail-'), clock());
  assert.equal(result.outcome, 'FAILURE'); assert.equal(mock.count(), 1);
});
