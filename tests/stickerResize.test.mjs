import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { testCurrentStickerResize } from '../dist/instagram/stickerResize.js';
const previous = process.env.DRY_RUN; process.env.DRY_RUN = 'true';
after(() => { if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous; });
const desc = 'Sticker. Touch and hold to reposition. Use two fingers to rotate or resize.';
function fixture({ stuck = false, fail = false, ambiguous = false } = {}) {
  let box = [0,1080,696,1196], gestures = 0, releases = 0, busy = false;
  const bounds = () => `[${box[0]},${box[1]}][${box[2]},${box[3]}]`;
  const session = {
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => { assert.equal(busy, false); return `<hierarchy><node resource-id="asset_button" displayed="true"/><node resource-id="com.instagram.android:id/capture_interactive_drawable_container" bounds="[0,0][1080,1920]" displayed="true"><node content-desc="${desc}" class="android.view.View" bounds="${bounds()}" displayed="true"/>${ambiguous ? `<node content-desc="${desc}" bounds="[10,20][30,40]" displayed="true"/>` : ''}</node></hierarchy>`; },
    $$: async () => [{ isExisting: async () => true, isDisplayed: async () => true, getText: async () => '', getAttribute: async key => key === 'bounds' ? bounds() : key === 'content-desc' ? desc : '' }],
    saveScreenshot: async path => writeFile(path, 'mock'), pause: async ms => { assert.equal(busy, false); assert.equal(ms, 1000); },
    performActions: async pointers => {
      busy = true; gestures++; assert.equal(pointers.length, 2);
      assert.deepEqual(pointers[0].actions.map(a => [a.type,a.duration]), pointers[1].actions.map(a => [a.type,a.duration]));
      assert.equal(pointers[0].parameters.pointerType, 'touch'); assert.equal(pointers[1].parameters.pointerType, 'touch');
      for (const index of [0,3]) {
        assert.equal(pointers[0].actions[index].x+pointers[1].actions[index].x, 696);
        for (const pointer of pointers) { assert.ok(pointer.actions[index].x > 0 && pointer.actions[index].x < 696); assert.equal(pointer.actions[index].y, 1138); }
      }
      assert.ok(pointers[0].actions[3].x > pointers[0].actions[0].x);
      assert.ok(pointers[1].actions[3].x < pointers[1].actions[0].x);
      if (fail) throw new Error('pinch timeout');
      if (!stuck) box = [104,1097,592,1179]; busy = false;
    },
    releaseActions: async () => { busy = false; releases++; },
    elementClick: async () => { throw new Error('não tocar ou publicar'); },
    execute: async () => { throw new Error('não ADB'); },
  };
  return { driver: { getSession: () => session }, counts: () => ({ gestures,releases }) };
}
test('pinch simétrico reduz width696 para faixa experimental sem mover deliberadamente', async () => {
  const mock = fixture(), dir = await mkdtemp('/tmp/sticker-resize-');
  const result = await testCurrentStickerResize(mock.driver, dir);
  assert.equal(result.resized, true); assert.equal(result.published, false);
  assert.ok(result.scale_ratio <= 0.85);
  assert.deepEqual(mock.counts(), { gestures: 1, releases: 1 });
  const report = JSON.parse(await readFile(`${dir}/resize-test.json`, 'utf8'));
  assert.equal(report.width_before, 696); assert.ok(report.width_after >= 450 && report.width_after <= 520);
});
for (const fail of [false,true]) test(`resize insuficiente/erro não repete; timeout=${fail}`, async () => {
  const mock = fixture({ stuck: true, fail }), dir = await mkdtemp('/tmp/sticker-resize-fail-');
  await assert.rejects(testCurrentStickerResize(mock.driver, dir), fail ? /pinch timeout/ : /menor que 15/);
  assert.deepEqual(mock.counts(), { gestures: 1, releases: 1 });
  assert.ok((await readFile(`${dir}/resize-test-error.xml`, 'utf8')).includes('hierarchy'));
});
test('resize recusa objeto ambíguo sem enviar toque', async () => {
  const mock = fixture({ ambiguous: true });
  await assert.rejects(testCurrentStickerResize(mock.driver, await mkdtemp('/tmp/sticker-resize-ambiguous-')), /único objeto/);
  assert.deepEqual(mock.counts(), { gestures: 0, releases: 0 });
});
