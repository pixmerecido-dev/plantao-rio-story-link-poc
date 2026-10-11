import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { stickerLayout } from '../dist/config/stickerLayout.js';
import { adjustLinkStickerLayout, layoutTarget, matchesStickerLayout, stickerBox } from '../dist/instagram/linkStickerLayout.js';
import { beginCurrentLinkTransaction, confirmCurrentLinkTransaction, requireCurrentLinkTransaction } from '../dist/instagram/appliedLinkSticker.js';
const desc = 'Sticker. Touch and hold to reposition. Use two fingers to rotate or resize.';
function fixture({ ignoreFirst = false, stuck = false, failGesture = false } = {}) {
  let sticker = false, bounds = '[192,902][888,1018]';
  const gestures = [], releases = [];
  const session = {
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => `<hierarchy><node resource-id="asset_button" displayed="true"/><node resource-id="com.instagram.android:id/capture_interactive_drawable_container" bounds="[0,100][1080,2020]" displayed="true">${sticker ? `<node content-desc="${desc}" class="android.view.View" bounds="${bounds}" displayed="true"/>` : ''}</node></hierarchy>`,
    $$: async selector => sticker && selector === `~${desc}` ? [{ isExisting: async () => true, isDisplayed: async () => true, getText: async () => '', getAttribute: async key => key === 'bounds' ? bounds : key === 'content-desc' ? desc : '' }] : [],
    saveScreenshot: async path => writeFile(path, 'mock'), pause: async () => {},
    releaseActions: async () => releases.push(true),
    performActions: async pointers => {
      gestures.push(pointers);
      if (failGesture) throw new Error('gesture failed');
      if (stuck || (ignoreFirst && gestures.length === 1)) return;
      const b = stickerBox(bounds), cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
      let w = b.right - b.left, h = b.bottom - b.top, x = cx, y = cy;
      if (pointers.length === 1) {
        const from = pointers[0].actions[0], to = pointers[0].actions[3]; x += to.x - from.x; y += to.y - from.y;
      } else {
        const ratio = (pointers[1].actions[3].x - pointers[0].actions[3].x) / (pointers[1].actions[0].x - pointers[0].actions[0].x);
        w *= ratio; h *= ratio;
      }
      bounds = `[${Math.round(x - w/2)},${Math.round(y-h/2)}][${Math.round(x+w/2)},${Math.round(y+h/2)}]`;
    },
  };
  return { driver: { getSession: () => session }, gestures, releases, bounds: () => bounds,
    confirm: async () => { await beginCurrentLinkTransaction(session, 'job-layout', 'https://example.org/', 'Leia a matéria completa'); sticker = true; assert.equal(await confirmCurrentLinkTransaction(session, { jobId: 'job-layout', url: 'https://example.org/', stickerText: 'Leia a matéria completa' }), true); } };
}
test('configuração padrão vem do modelo; valores inválidos/fora do canvas abortam', () => {
  const config = stickerLayout({});
  assert.equal(config.centerX, 0.303); assert.equal(config.centerY, 0.593);
  for (const value of ['NaN', '-1', '0', '2']) assert.throws(() => stickerLayout({ TARGET_STICKER_WIDTH: value }), /Layout inválido/);
  assert.throws(() => stickerLayout({ TARGET_STICKER_CENTER_X: '0.01' }), /Layout inválido/);
});
test('geometria relativa inclui offset do canvas e preserva proporção', () => {
  const canvas = { left: 50, top: 100, right: 1130, bottom: 2020 }, box = stickerBox('[192,902][888,1018]');
  const target = layoutTarget(canvas, box, stickerLayout({}));
  assert.equal((target.left + target.right)/2, 50 + 1080 * 0.303);
  assert.equal((target.top + target.bottom)/2, 100 + 1920 * 0.593);
  assert.ok(Math.abs((target.right-target.left)/(target.bottom-target.top) - 6) < 0.0001);
  assert.equal(matchesStickerLayout(box, target, canvas, 0.005), false);
});
for (const ignoreFirst of [false, true]) test(`drag + pinch verificam bounds e preservam transação; retry=${ignoreFirst}`, async () => {
  const mock = fixture({ ignoreFirst }); await mock.confirm();
  const dir = await mkdtemp('/tmp/link-layout-');
  const result = await adjustLinkStickerLayout(mock.driver, 'job-layout', dir);
  assert.equal(await requireCurrentLinkTransaction(mock.driver.getSession(), 'job-layout'), 'job-layout');
  assert.equal(mock.gestures.length, ignoreFirst ? 3 : 2);
  assert.equal(mock.releases.length, mock.gestures.length);
  assert.ok(matchesStickerLayout(stickerBox(result.bounds), result.target, { left: 0, top: 100, right: 1080, bottom: 2020 }, 0.005));
  const log = JSON.parse(await readFile(`${dir}/link-layout.json`, 'utf8'));
  assert.equal(log.attempts.length, ignoreFirst ? 2 : 1);
  for (const action of mock.gestures) for (const finger of action) for (const move of finger.actions.filter(item => item.type === 'pointerMove')) {
    assert.ok(move.x > 0 && move.x < 1080 && move.y > 100 && move.y < 2020);
  }
});
test('falha após duas tentativas invalida autorização; nenhum gesto adicional', async () => {
  const mock = fixture({ stuck: true }); await mock.confirm();
  await assert.rejects(adjustLinkStickerLayout(mock.driver, 'job-layout', await mkdtemp('/tmp/link-layout-stuck-')), /dois ajustes/);
  assert.equal(mock.gestures.length, 2);
  await assert.rejects(requireCurrentLinkTransaction(mock.driver.getSession(), 'job-layout'), /transaction confirmed/);
});
test('erro técnico não repete gesto incerto e libera pointers', async () => {
  const mock = fixture({ failGesture: true }); await mock.confirm();
  await assert.rejects(adjustLinkStickerLayout(mock.driver, 'job-layout', await mkdtemp('/tmp/link-layout-failure-')), /gesture failed/);
  assert.equal(mock.gestures.length, 1); assert.equal(mock.releases.length, 1);
});
test('outro job ou sticker não confirmado não recebe gesto', async () => {
  const mock = fixture(); await mock.confirm();
  await assert.rejects(adjustLinkStickerLayout(mock.driver, 'other-job', await mkdtemp('/tmp/link-layout-job-')), /current job match/);
  assert.equal(mock.gestures.length, 0);
});
