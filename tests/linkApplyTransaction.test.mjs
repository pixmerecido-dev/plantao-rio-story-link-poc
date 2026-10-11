import test from 'node:test';
import assert from 'node:assert/strict';
import { beginCurrentLinkTransaction, confirmCurrentLinkTransaction, clearCurrentLinkTransaction, inspectAppliedLinkSticker } from '../dist/instagram/appliedLinkSticker.js';
const desc = 'Sticker. Touch and hold to reposition. Use two fingers to rotate or resize.';
const bounds = '[192,902][888,1018]';
function fixture() {
  let hasSticker = false;
  const session = {
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => `<hierarchy><node resource-id="asset_button" displayed="true"/><node resource-id="com.instagram.android:id/capture_interactive_drawable_container" bounds="[0,0][1080,1920]" displayed="true">${hasSticker ? `<node content-desc="${desc}" bounds="${bounds}" displayed="true"/>` : ''}</node></hierarchy>`,
    $$: async selector => hasSticker && selector === `~${desc}` ? [{ isExisting: async () => true, isDisplayed: async () => true, getAttribute: async key => key === 'bounds' ? bounds : key === 'content-desc' ? desc : '', getText: async () => '' }] : [],
  };
  return { session, sticker: value => { hasSticker = value; } };
}
const values = { jobId: 'current-job', url: 'https://plantaorio.com.br/materia-x', stickerText: 'Leia a matéria completa' };
test('objeto genérico novo é Link somente após confirmação do job atual', async () => {
  const mock = fixture();
  await beginCurrentLinkTransaction(mock.session, values.jobId, values.url, values.stickerText);
  mock.sticker(true);
  assert.equal((await inspectAppliedLinkSticker(mock.session)).applied, false);
  assert.equal(await confirmCurrentLinkTransaction(mock.session, { ...values, jobId: 'other-job' }), false);
  assert.equal(await confirmCurrentLinkTransaction(mock.session, values), true);
  assert.equal((await inspectAppliedLinkSticker(mock.session)).applied, true);
  clearCurrentLinkTransaction(mock.session);
  assert.equal((await inspectAppliedLinkSticker(mock.session)).applied, false);
});
test('sticker antigo não inicia transação e nova sessão não herda confirmação', async () => {
  const mock = fixture(); mock.sticker(true);
  await assert.rejects(beginCurrentLinkTransaction(mock.session, values.jobId, values.url, values.stickerText), /editor limpo/);
  assert.equal(await confirmCurrentLinkTransaction(mock.session, values), false);
  assert.equal((await inspectAppliedLinkSticker(mock.session)).applied, false);
});
test('sem novo objeto ou com dados alterados não confirma; remoção invalida confirmação', async () => {
  const mock = fixture();
  await beginCurrentLinkTransaction(mock.session, values.jobId, values.url, values.stickerText);
  assert.equal(await confirmCurrentLinkTransaction(mock.session, values), false);
  mock.sticker(true);
  assert.equal(await confirmCurrentLinkTransaction(mock.session, { ...values, stickerText: 'Outro' }), false);
  assert.equal(await confirmCurrentLinkTransaction(mock.session, values), true);
  mock.sticker(false);
  assert.equal((await inspectAppliedLinkSticker(mock.session)).applied, false);
  mock.sticker(true);
  assert.equal((await inspectAppliedLinkSticker(mock.session)).applied, false);
});
