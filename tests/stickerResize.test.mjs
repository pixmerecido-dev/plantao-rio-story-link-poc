import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { testCurrentStickerResize } from '../dist/instagram/stickerResize.js';
const previous = process.env.DRY_RUN; process.env.DRY_RUN = 'true';
after(() => { if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous; });
const desc = 'Sticker. Touch and hold to reposition. Use two fingers to rotate or resize.';
function fixture({ mode = 'success', ambiguous = false } = {}) {
  let box = [0,1080,696,1196], queries = 0;
  const calls = [];
  const bounds = () => `[${box[0]},${box[1]}][${box[2]},${box[3]}]`;
  const session = {
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => { queries++; return `<hierarchy><node resource-id="asset_button" displayed="true"/><node resource-id="com.instagram.android:id/capture_interactive_drawable_container" bounds="[0,0][1080,1920]" displayed="true"><node content-desc="${desc}" class="android.view.View" bounds="${bounds()}" displayed="true"/>${ambiguous ? `<node content-desc="${desc}" bounds="[10,20][30,40]" displayed="true"/>` : ''}</node></hierarchy>`; },
    $$: async () => [{ isExisting: async () => true, isDisplayed: async () => true, getText: async () => '', getAttribute: async key => key === 'bounds' ? bounds() : key === 'content-desc' ? desc : '' }],
    saveScreenshot: async path => writeFile(path, 'mock'), pause: async ms => assert.equal(ms,1000),
    performActions: async () => { throw new Error('não usar implementação W3C anterior'); },
    elementClick: async () => { throw new Error('não tocar/publicar'); },
    execute: async (command, args) => {
      assert.equal(command,'mobile: pinchCloseGesture');
      assert.deepEqual(args, { left: 0, top: 1080, width: 696, height: 116, percent: calls.length === 0 ? 0.50 : 0.75 });
      calls.push({ command, args, queries });
      if (mode === 'timeout') throw new Error('native pinch timeout');
      if (mode === 'stuck' || (mode === 'second' && calls.length === 1)) return;
      box = mode === 'excessive' ? [248,1121,448,1155] : mode === 'small' ? [20,1084,676,1192] : mode === 'shift' ? [1,1080,697,1196] : [104,1097,592,1179];
    },
  };
  return { driver: { getSession: () => session }, calls };
}
for (const mode of ['success','second','excessive']) test(`pinch nativo por área; modo=${mode}`, async () => {
  const mock = fixture({ mode }), dir = await mkdtemp('/tmp/sticker-resize-native-');
  const result = await testCurrentStickerResize(mock.driver,dir);
  assert.equal(result.resized,true); assert.ok(result.scale_ratio <= 0.9);
  assert.equal(mock.calls.length,mode === 'second' ? 2 : 1);
  if (mode === 'second') assert.ok(mock.calls[1].queries > mock.calls[0].queries, 'reler hierarchy antes do segundo gesto');
  const report = JSON.parse(await readFile(`${dir}/resize-test.json`,'utf8'));
  assert.equal(report.gesture_attempts,mock.calls.length);
  assert.equal(report.attempts[0].percent,0.50);
});
for (const mode of ['stuck','timeout','small','shift']) test(`resize aborta sem correção/alternativa: ${mode}`, async () => {
  const mock = fixture({ mode }), dir = await mkdtemp('/tmp/sticker-resize-native-fail-');
  await assert.rejects(testCurrentStickerResize(mock.driver,dir),mode === 'timeout' ? /native pinch timeout/ : mode === 'stuck' ? /inalterados após/ : /menor que 10/);
  assert.equal(mock.calls.length,mode === 'stuck' ? 2 : 1);
  assert.ok((await readFile(`${dir}/resize-test-error.xml`,'utf8')).includes('hierarchy'));
});
test('objeto ambíguo recusa gesture antes de qualquer comando',async () => {
  const mock = fixture({ ambiguous:true });
  await assert.rejects(testCurrentStickerResize(mock.driver,await mkdtemp('/tmp/sticker-resize-ambiguous-')),/único objeto/);
  assert.equal(mock.calls.length,0);
});
