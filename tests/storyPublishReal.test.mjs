import { confirmApprovedStickerLayout, clearApprovedStickerLayout } from '../dist/instagram/approvedStickerLayout.js';
import { completeCurrentStoryJob } from '../dist/instagram/storyEndToEndReal.js';
import { randomUUID } from 'node:crypto';
import { beginCurrentLinkTransaction, confirmCurrentLinkTransaction } from '../dist/instagram/appliedLinkSticker.js';
import { description, bounds as originalBounds, positiveCanvasXML, appliedElement } from './helpers/appliedLinkFixture.mjs';
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
function fixture({ target = 'STATE_HOME', clickable = 'true', enabled = true, ambiguous = false, clickThrows = false, revoke = false, holder = true, failure = false, facebook = false, stuckFacebook = false, ack = false, ambiguousFacebook = false } = {}) {
  let clicked = false;
  let count = 0, facebookClicks = 0, facebookClosed = false;
  const button = {
    elementId: 'share-real-id',
    isExisting: async () => !clicked, isDisplayed: async () => !clicked, isEnabled: async () => enabled,
    getAttribute: async name => ({ clickable, 'resource-id': SHARE_SHORTCUT_ID, 'content-desc': 'Your story', class: 'android.widget.Button' })[name],
    click: async () => { count++; assert.equal(count, 1); clicked = true; if (clickThrows) throw new Error('click transport timeout'); },
  };
  const visible = { isExisting: async () => true, isDisplayed: async () => true };
  const session = {
    elementClick: async id => {
      if (id === 'always-share-real-id') { facebookClicks++; assert.equal(facebookClicks, 1); if (!stuckFacebook) facebookClosed = true; return; }
      assert.equal(id, button.elementId); await button.click();
    },
    $: async selector => ({ isExisting: async () => (!clicked || target === 'STATE_EDITOR_WITH_LINK') && selector === resourceIdSelector('asset_button') || clicked && target === 'STATE_HOME' && selector === resourceIdSelector('com.instagram.android:id/feed_tab'), isDisplayed: async () => true }),
    $$: async selector => {
      if (facebook && clicked && !facebookClosed && selector === 'android=new UiSelector().text("Always share stories")') {
        const always = { elementId: 'always-share-real-id', isExisting: async () => true, isDisplayed: async () => true, isEnabled: async () => true,
          getAttribute: async key => key === 'clickable' ? 'true' : '', getText: async () => 'Always share stories' };
        return ambiguousFacebook ? [always, always] : [always];
      }
      if (clicked && target !== 'STATE_EDITOR_WITH_LINK') return [];
      if (selector === `~${description}`) return holder ? [{ ...appliedElement(),getAttribute:async key => key === 'bounds' ? '[83,1094][612,1182]' : appliedElement().getAttribute(key) }] : [];
      if (selector === resourceIdSelector(LINK_STICKER_HOLDER_ID)) return holder ? [visible] : [];
      if (selector === resourceIdSelector(SHARE_SHORTCUT_ID)) return ambiguous ? [button, button] : [button];
      return [];
    },
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => facebook && clicked && !facebookClosed ? `<hierarchy><node class="android.app.Dialog"><node text="${facebook === 'unknown' ? 'Unknown sharing prompt' : 'Share your stories to Facebook too'}"/><node text="Let your followers see your stories, no matter which app they're on."/><node text="Always share stories" class="android.widget.Button"/><node text="Not now" class="android.widget.Button"/><node text="${facebook === 'unknown' && ack ? 'Your story was shared' : ''}"/></node></hierarchy>` : `<hierarchy>${holder && (!clicked || target === 'STATE_EDITOR_WITH_LINK') ? positiveCanvasXML.replace(originalBounds,'[83,1094][612,1182]') : ''}<node text="${clicked ? failure ? 'Failed to upload' : ack && (!facebook || facebookClosed) ? 'Your story was shared' : 'after' : 'before'}"/></hierarchy>`,
    saveScreenshot: async path => { await writeFile(path, 'fixture'); if (revoke && path.includes('pre-publish')) process.env.CONFIRM_REAL_PUBLISH = 'NO'; },
    waitUntil: async callback => { for (let i = 0; i < 2; i++) if (await callback()) return; throw new Error('timeout'); },
  };
  const jobId = randomUUID();
  return { driver: { getSession: () => session }, count: () => count, facebookCount: () => facebookClicks, jobId, confirm: async () => {
    const read = session.getPageSource;
    session.getPageSource = async () => '<hierarchy><node resource-id="asset_button" displayed="true"/></hierarchy>';
    await beginCurrentLinkTransaction(session, jobId, 'https://plantaorio.com.br/', 'Leia a matéria completa');
    session.getPageSource = read;
    const confirmed = await confirmCurrentLinkTransaction(session, { jobId, url: 'https://plantaorio.com.br/', stickerText: 'Leia a matéria completa' });
    if (confirmed) await confirmApprovedStickerLayout(session,jobId);
    return confirmed;
  } };
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
  await mock.confirm();
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
    await mock.confirm();
  await assert.rejects(publishStoryOnce(mock.driver, await mkdtemp('/tmp/publish-invalid-'), clock()));
    assert.equal(mock.count(), 0);
  });
}
for (const options of [{ target: 'STATE_EDITOR_WITH_LINK' }, { target: 'STATE_UNKNOWN' }, { clickThrows: true, target: 'STATE_EDITOR_WITH_LINK' }]) {
  test(`incerteza pós-clique nunca repete publicação: ${JSON.stringify(options)}`, async () => {
    authorize(); const mock = fixture(options); const dir = await mkdtemp('/tmp/publish-timeout-');
    await mock.confirm();
  const result = await publishStoryOnce(mock.driver, dir, clock());
    assert.equal(result.outcome, 'INCONCLUSIVE'); assert.equal(mock.count(), 1);
    assert.ok((await readdir(dir)).includes('post-publish-15s.xml'));
  });
}
test('revogação da trava durante captura impede clique', async () => {
  authorize(); const mock = fixture({ revoke: true });
  await mock.confirm();
  await assert.rejects(publishStoryOnce(mock.driver, await mkdtemp('/tmp/publish-revoke-'), clock()), /exige/);
  assert.equal(mock.count(), 0);
});
test('falha de envio observada não provoca outro clique', async () => {
  authorize(); const mock = fixture({ failure: true });
  await mock.confirm();
  const result = await publishStoryOnce(mock.driver, await mkdtemp('/tmp/publish-fail-'), clock());
  assert.equal(result.outcome, 'FAILURE'); assert.equal(mock.count(), 1);
});

test('editor estrutural positivo de processo anterior não autoriza publicar', async () => {
  authorize(); const mock = fixture();
  await assert.rejects(publishStoryOnce(mock.driver, await mkdtemp('/tmp/publish-no-current-job-'), clock()), /transaction confirmed/);
  assert.equal(mock.count(), 0);
});
test('job incorreto é bloqueado e identificação original acompanha envio único', async () => {
  authorize(); const mock = fixture(); await mock.confirm();
  await assert.rejects(publishStoryOnce(mock.driver, await mkdtemp('/tmp/publish-wrong-job-'), clock(), { job_id: 'other-job', image_sha256: 'abc' }), /current job match/);
  assert.equal(mock.count(), 0);
  const result = await publishStoryOnce(mock.driver, await mkdtemp('/tmp/publish-current-job-'), clock(), { job_id: mock.jobId, image_sha256: 'original-image-hash' });
  assert.equal(result.job_id, mock.jobId);
  assert.equal(result.media_id, `${mock.jobId}:image-sha256:original-image-hash`);
  assert.equal(result.media_identity_source, 'job-image-sha256');
  assert.equal(result.outcome, 'INCONCLUSIVE');
  assert.equal(mock.count(), 1);
});

test('preparação e envio usam mesma sessão, mesmo job e memória sem reconectar', async () => {
  authorize(); const mock = fixture(); const session = mock.driver.getSession();
  const job = { job_id: mock.jobId, image: 'source.jpg', image_sha256: 'source-hash', story_url: 'https://plantaorio.com.br/', sticker_text: 'Leia a matéria completa', publish_instagram: false, publish_facebook: false };
  const result = await completeCurrentStoryJob(mock.driver, job, await mkdtemp('/tmp/e2e-same-process-'), async () => {
    assert.equal(mock.driver.getSession(), session);
    assert.equal(mock.count(), 0);
    assert.equal(await mock.confirm(), true);
    return { job_id: job.job_id, published: false };
  }, clock());
  assert.equal(result.job_id, job.job_id);
  assert.equal(result.publication.job_id, job.job_id);
  assert.equal(mock.count(), 1);
  assert.equal(result.publication.outcome, 'INCONCLUSIVE');
});
test('preparação sem transação do job e falha na preparação impedem clique', async () => {
  authorize(); const mock = fixture();
  const job = { job_id: mock.jobId, image: 'source.jpg', image_sha256: 'source-hash', story_url: 'https://plantaorio.com.br/', sticker_text: 'Leia a matéria completa', publish_instagram: false, publish_facebook: false };
  await assert.rejects(completeCurrentStoryJob(mock.driver, job, await mkdtemp('/tmp/e2e-no-transaction-'), async () => ({}), clock()), /transaction confirmed/);
  await assert.rejects(completeCurrentStoryJob(mock.driver, job, await mkdtemp('/tmp/e2e-preparation-failed-'), async () => { throw new Error('preparação falhou'); }, clock()), /preparação falhou/);
  assert.equal(mock.count(), 0);
});

for (const [name, options, outcome, facebookCount, enabled] of [
  ['modal aceito e mensagem positiva', { facebook: true, ack: true }, 'SUCCESS', 1, true],
  ['modal aceito e somente Home', { facebook: true }, 'INCONCLUSIVE', 1, true],
  ['modal preso', { facebook: true, stuckFacebook: true }, 'INCONCLUSIVE', 1, null],
  ['controle vivo ambíguo', { facebook: true, ambiguousFacebook: true }, 'INCONCLUSIVE', 0, null],
  ['próxima execução sem modal', { ack: true }, 'SUCCESS', 0, null],
]) test(`continuação Facebook: ${name}`, async () => {
  authorize(); const mock = fixture(options); await mock.confirm();
  const dir = await mkdtemp('/tmp/facebook-sharing-publication-');
  const result = await publishStoryOnce(mock.driver, dir, clock());
  assert.equal(result.job_id, mock.jobId);
  assert.equal(result.link_transaction_at_publish.job_id, mock.jobId);
  assert.equal(result.link_transaction_at_publish.transaction_confirmed, true);
  assert.equal(result.link_transaction_at_publish.current_job_match, true);
  assert.equal(result.outcome, outcome);
  assert.equal(mock.count(), 1);
  assert.equal(mock.facebookCount(), facebookCount);
  assert.equal(result.facebook_crosspost_enabled, enabled);
  if (options.facebook) {
    const files = await readdir(dir);
    for (const stage of ['facebook-sharing-prompt-before', 'facebook-sharing-prompt-after']) for (const ext of ['xml', 'png', 'json']) assert.ok(files.includes(`${stage}.${ext}`));
    if (facebookCount) {
      const continuation = JSON.parse(await readFile(`${dir}/facebook-sharing-continuation.json`, 'utf8'));
      assert.equal(continuation.job_id, mock.jobId);
      assert.equal(continuation.status, 'PUBLISH_PENDING_CONFIRMATION');
      assert.equal(continuation.retryAllowed, false);
    }
  }
});

test('diálogo diferente não recebe clique e mantém INCONCLUSIVE mesmo com mensagem positiva', async () => {
  authorize(); const mock = fixture({ facebook: 'unknown', ack: true }); await mock.confirm();
  const result = await publishStoryOnce(mock.driver, await mkdtemp('/tmp/publish-unknown-dialog-'), clock());
  assert.equal(result.outcome, 'INCONCLUSIVE');
  assert.equal(result.unknown_dialog_observed, true);
  assert.equal(mock.count(), 1);
  assert.equal(mock.facebookCount(), 0);
});

test('Link confirmado sem layout aprovado bloqueia publicação',async () => {
  authorize(); const mock = fixture(); await mock.confirm();
  clearApprovedStickerLayout(mock.driver.getSession());
  await assert.rejects(publishStoryOnce(mock.driver,await mkdtemp('/tmp/publish-layout-blocked-'),clock()),/layout_confirmed=false/);
  assert.equal(mock.count(),0);
});
