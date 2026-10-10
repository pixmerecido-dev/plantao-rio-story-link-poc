import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAppliedLinkCanvas, inspectAppliedLinkSticker, assertNoUnconfirmedAppliedSticker } from '../dist/instagram/appliedLinkSticker.js';
import { detectInstagramState } from '../dist/instagram/instagramStateMachine.js';
const holder = '<node resource-id="com.instagram.android:id/video_sticker_ltr_holder" bounds="[0,0][1080,1920]" displayed="true"/>';
const genericDescription = 'Sticker. Touch and hold to reposition. Use two fingers to rotate or resize.';
const domainDescription = `${genericDescription} https://plantaorio.com.br/materia-x`;
const canvas = child => `<node resource-id="com.instagram.android:id/capture_interactive_drawable_container" bounds="[0,0][1080,1920]" displayed="true">${child}</node>`;
const sticker = (description, extra = '') => `<node content-desc="${description}" text="" bounds="[202,901][877,1017]" displayed="true" ${extra}/>`;
const screen = body => `<hierarchy><node resource-id="asset_button" displayed="true"/><node resource-id="com.instagram.android:id/your_story_share_shortcut_button" displayed="true"/>${body}</hierarchy>`;
function fixture(source, { liveDisplayed = true, staleBounds = false, packageName = 'com.instagram.android' } = {}) {
  const report = analyzeAppliedLinkCanvas(source);
  const reads = [];
  const session = {
    getPageSource: async () => source, getCurrentPackage: async () => packageName,
    $: async selector => ({ isExisting: async () => selector.includes('asset_button'), isDisplayed: async () => true }),
    $$: async selector => {
      reads.push(selector);
      return report.candidates.filter(candidate => selector === candidate.selector).map(candidate => ({
        isExisting: async () => true, isDisplayed: async () => liveDisplayed,
        getAttribute: async name => name === 'bounds' ? staleBounds ? '[1,2][3,4]' : candidate.bounds : name === 'content-desc' ? candidate.contentDesc : '',
        getText: async () => candidate.text,
      }));
    },
  };
  return { session, reads };
}
test('imagem com holder vazio e Your story é EDITOR, sem link', async () => {
  const mock = fixture(screen(holder + canvas('')));
  assert.equal(await detectInstagramState(mock.session), 'STATE_EDITOR');
  const report = await inspectAppliedLinkSticker(mock.session);
  assert.equal(report.applied, false); assert.equal(report.candidates.length, 0);
  await assertNoUnconfirmedAppliedSticker(mock.session);
});
test('URL de toolbar/metadados/fora do canvas não confirma Link Sticker', async () => {
  const mock = fixture(screen(holder + sticker(domainDescription) + '<node text="Link" resource-id="fixture:id/link_metadata"/>'));
  assert.equal(await detectInstagramState(mock.session), 'STATE_EDITOR');
  assert.equal((await inspectAppliedLinkSticker(mock.session)).applied, false);
});
test('objeto aplicado no canvas com identidade Link visível confirma WITH_LINK', async () => {
  const mock = fixture(screen(holder + canvas(sticker(domainDescription))));
  assert.equal(await detectInstagramState(mock.session), 'STATE_EDITOR_WITH_LINK');
  assert.equal((await inspectAppliedLinkSticker(mock.session)).applied, true);
});
test('sticker aplicado genérico observado no artefato não prova Link e impede reaplicação', async () => {
  const mock = fixture(screen(holder + canvas(sticker(genericDescription))));
  assert.equal(await detectInstagramState(mock.session), 'STATE_EDITOR');
  const report = await inspectAppliedLinkSticker(mock.session);
  assert.equal(report.applied, false); assert.equal(report.unconfirmedAppliedSticker, true);
  await assert.rejects(assertNoUnconfirmedAppliedSticker(mock.session), /reaplicação bloqueada/);
});
for (const option of [{ liveDisplayed: false }, { staleBounds: true }, { packageName: 'other.app' }]) {
  test(`estado stale/oculto/fora do Instagram não confirma link: ${JSON.stringify(option)}`, async () => {
    const mock = fixture(screen(canvas(sticker(domainDescription))), option);
    assert.equal((await inspectAppliedLinkSticker(mock.session)).applied, false);
  });
}
test('ancestral oculto exclui candidato e palavra link isolada não identifica tipo', async () => {
  const hidden = fixture(screen(`<node displayed="false">${canvas(sticker(domainDescription))}</node>`));
  assert.equal((await inspectAppliedLinkSticker(hidden.session)).applied, false);
  const wordOnly = fixture(screen(canvas(sticker(`${genericDescription} link`))));
  assert.equal((await inspectAppliedLinkSticker(wordOnly.session)).applied, false);
});
test('bounds sem área e fora do canvas nunca confirmam sticker', () => {
  assert.equal(analyzeAppliedLinkCanvas(screen(canvas(sticker(domainDescription).replace('[202,901][877,1017]', '[0,0][0,0]')))).candidates.length, 0);
  assert.equal(analyzeAppliedLinkCanvas(screen(canvas(sticker(domainDescription).replace('[202,901][877,1017]', '[0,1950][200,2000]')))).candidates.length, 0);
});
