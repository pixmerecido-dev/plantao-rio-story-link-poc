import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { testW3CStickerMovement } from '../dist/instagram/stickerW3CMoveTest.js';
import { buildSteppedStickerMoveActions } from '../dist/instagram/stickerTouchActions.js';
const previous = process.env.DRY_RUN; process.env.DRY_RUN = 'true';
after(() => { if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous; });
const desc = 'Sticker. Touch and hold to reposition. Use two fingers to rotate or resize.';
function fixture({ stuck = false, fail = false, boundary = false } = {}) {
  let bounds = '[64,1079][760,1195]', gestures = 0, releases = 0, during = false;
  const session = {
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => { assert.equal(during, false, 'não reler durante pointerDown'); return `<hierarchy><node resource-id="asset_button" displayed="true"/><node resource-id="com.instagram.android:id/capture_interactive_drawable_container" bounds="[0,0][1080,1920]" displayed="true"><node content-desc="${desc}" bounds="${bounds}" class="android.view.View" displayed="true"/></node></hierarchy>`; },
    $$: async () => [{ isExisting: async () => true, isDisplayed: async () => true, getText: async () => '', getAttribute: async key => key === 'bounds' ? bounds : key === 'content-desc' ? desc : '' }],
    saveScreenshot: async path => writeFile(path, 'mock'), pause: async ms => { assert.equal(during, false); assert.equal(ms, 1000); },
    performActions: async actions => {
      gestures++; during = true;
      assert.deepEqual(actions, buildSteppedStickerMoveActions({ x: 412, y: 1137 }, { x: 162, y: 1137 }));
      if (fail) throw new Error('pointer transport timeout');
      bounds = stuck ? '[64,1080][760,1196]' : boundary ? '[0,1079][696,1195]' : '[0,1079][510,1195]'; during = false;
    },
    releaseActions: async () => { releases++; during = false; },
    execute: async () => { throw new Error('Não usar ADB/mobile ou resize'); },
  };
  return { driver: { getSession: () => session }, counts: () => ({ gestures, releases }) };
}
test('plano W3C exato: hold 900ms, cinco passos de 200ms, pause150, único up', () => {
  const [pointer] = buildSteppedStickerMoveActions({ x: 412, y: 1137 }, { x: 162, y: 1137 });
  assert.equal(pointer.parameters.pointerType, 'touch');
  assert.deepEqual(pointer.actions.map(action => action.type), ['pointerMove', 'pointerDown', 'pause', ...Array(5).fill('pointerMove'), 'pause', 'pointerUp']);
  assert.equal(pointer.actions[2].duration, 900); assert.equal(pointer.actions[8].duration, 150);
  assert.deepEqual(pointer.actions.slice(3,8).map(action => [action.x,action.y,action.duration]), [[362,1137,200],[312,1137,200],[262,1137,200],[212,1137,200],[162,1137,200]]);
});
test('movimento grande confirmado após pointerUp e espera, com apenas um gesto', async () => {
  const mock = fixture(), directory = await mkdtemp('/tmp/w3c-sticker-move-');
  const result = await testW3CStickerMovement(mock.driver, directory);
  assert.equal(result.moved, true); assert.ok(Math.abs(result.actual_delta.x) >= 120);
  assert.deepEqual(mock.counts(), { gestures: 1, releases: 1 });
  const report = JSON.parse(await readFile(`${directory}/move-test.json`, 'utf8'));
  assert.equal(report.gesture_attempts, 1); assert.equal(report.hold_ms, 900);
});
for (const fail of [false,true]) test(`falha/timeout salva captura e não repete nem usa alternativa, timeout=${fail}`, async () => {
  const mock = fixture({ stuck: true, fail });
  const directory = await mkdtemp('/tmp/w3c-sticker-fail-');
  await assert.rejects(testW3CStickerMovement(mock.driver, directory), fail ? /transport timeout/ : /clamp não confirmado/);
  assert.deepEqual(mock.counts(), { gestures: 1, releases: 1 });
  assert.ok((await readFile(`${directory}/move-test-error.xml`, 'utf8')).includes('hierarchy'));
});

test('resultado real -64px e borda esquerda é sucesso, não falso negativo de 120px', async () => {
  const mock = fixture({ boundary: true });
  const result = await testW3CStickerMovement(mock.driver, await mkdtemp('/tmp/w3c-sticker-boundary-'));
  assert.equal(result.actual_delta.x, -64);
  assert.equal(result.boundary_clamp, 'LEFT');
  assert.equal(result.moved, true);
  assert.deepEqual(mock.counts(), { gestures: 1, releases: 1 });
});
