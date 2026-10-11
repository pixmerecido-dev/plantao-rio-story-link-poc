import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { testNativeStickerMovement } from '../dist/instagram/stickerNativeMoveTest.js';
const old = process.env.DRY_RUN; process.env.DRY_RUN = 'true';
after(() => { if (old === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = old; });
const desc = 'Sticker. Touch and hold to reposition. Use two fingers to rotate or resize.';
function fixture(dx = -200, options = {}) {
  let box = options.nearEdge ? [0,1063,240,1179] : [64,1063,760,1179];
  const commands = [];
  const bounds = () => `[${box[0]},${box[1]}][${box[2]},${box[3]}]`;
  const session = {
    capabilities: { deviceUDID: 'connected-real-session-device' },
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => `<hierarchy><node resource-id="asset_button" displayed="true"/><node resource-id="com.instagram.android:id/capture_interactive_drawable_container" bounds="[0,0][1080,1920]" displayed="true"><node content-desc="${desc}" bounds="${bounds()}" class="android.view.View" displayed="true"/></node></hierarchy>`,
    $$: async () => [{ isExisting: async () => true, isDisplayed: async () => true, getText: async () => '', getAttribute: async key => key === 'bounds' ? bounds() : key === 'content-desc' ? desc : '' }],
    pause: async ms => assert.equal(ms, 1000), saveScreenshot: async path => writeFile(path, 'mock'),
    performActions: async () => { throw new Error('Não usar W3C/pinch neste teste'); },
  };
  const run = async (device, args) => {
    commands.push(args); assert.equal(device, 'connected-real-session-device');
    assert.deepEqual(args, ['shell', 'input', 'touchscreen', 'swipe', '412', '1121', '162', '1121', '1400']);
    if (options.fail) throw new Error('adb timeout');
    box = [Math.max(0, box[0]+dx), box[1]+11, box[2]+dx, box[3]+11];
    return { stdout: '', stderr: '' };
  };
  return { driver: { getSession: () => session }, commands, run };
}
test('swipe único dinâmico do caso real confirma deslocamento horizontal grande', async () => {
  const mock = fixture(-250), dir = await mkdtemp('/tmp/native-sticker-move-');
  const result = await testNativeStickerMovement(mock.driver, dir, mock.run);
  assert.equal(result.moved, true); assert.ok(Math.abs(result.actual_delta.x) >= 120);
  assert.equal(mock.commands.length, 1);
  const diagnostic = JSON.parse(await readFile(`${dir}/move-test.json`, 'utf8'));
  assert.equal(diagnostic.duration_ms, 1400); assert.equal(diagnostic.swipe_attempts, 1);
});
for (const fail of [false, true]) test(`sem movimento suficiente/timeout não tenta outra estratégia, timeout=${fail}`, async () => {
  const mock = fixture(0, { fail });
  await assert.rejects(testNativeStickerMovement(mock.driver, await mkdtemp('/tmp/native-sticker-fail-'), mock.run), fail ? /adb timeout/ : /menor que 120/);
  assert.equal(mock.commands.length, 1);
});
test('endpoint é limitado à área segura e insuficiência aborta antes do comando', async () => {
  const mock = fixture(-250, { nearEdge: true });
  await assert.rejects(testNativeStickerMovement(mock.driver, await mkdtemp('/tmp/native-sticker-edge-'), mock.run), /Área segura/);
  assert.equal(mock.commands.length, 0);
});
