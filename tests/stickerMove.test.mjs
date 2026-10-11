import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { moveCurrentCanvasSticker } from '../dist/instagram/stickerMove.js';
import { buildStickerMoveActions, buildStickerPinchActions } from '../dist/instagram/stickerTouchActions.js';
const old = process.env.DRY_RUN; process.env.DRY_RUN = 'true';
after(() => { if (old === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = old; });
const desc = 'Sticker. Touch and hold to reposition. Use two fingers to rotate or resize.';
function fixture({ stuck = false, partial = false, ambiguous = false, fail = false, already = false } = {}) {
  let box = already ? [2,1080,698,1196] : [192,902,888,1018];
  const gestures = []; let releases = 0;
  const bounds = () => `[${box[0]},${box[1]}][${box[2]},${box[3]}]`;
  const session = {
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => `<hierarchy><node resource-id="asset_button" displayed="true"/><node resource-id="com.instagram.android:id/capture_interactive_drawable_container" bounds="[0,0][1080,1920]" displayed="true"><node content-desc="${desc}" class="android.view.View" bounds="${bounds()}" displayed="true"/>${ambiguous ? `<node content-desc="${desc}" class="android.view.View" bounds="[10,20][50,60]" displayed="true"/>` : ''}</node></hierarchy>`,
    $$: async selector => selector === `~${desc}` ? [{ isExisting: async () => true, isDisplayed: async () => true, getText: async () => '', getAttribute: async key => key === 'bounds' ? bounds() : key === 'content-desc' ? desc : '' }] : [],
    pause: async milliseconds => assert.equal(milliseconds, 1000), saveScreenshot: async path => writeFile(path, 'mock'),
    releaseActions: async () => { releases++; },
    performActions: async pointers => {
      assert.equal(pointers.length, 1, 'não fazer resize'); gestures.push(pointers);
      if (fail) throw new Error('touch failed');
      if (stuck) return;
      const actions = pointers[0].actions, ratio = partial && gestures.length === 1 ? 0.5 : 1;
      const dx = (actions[3].x - actions[0].x) * ratio, dy = (actions[3].y - actions[0].y) * ratio;
      box = [Math.round(box[0]+dx), Math.round(box[1]+dy), Math.round(box[2]+dx), Math.round(box[3]+dy)];
    },
  };
  return { driver: { getSession: () => session }, gestures, releases: () => releases, bounds };
}
test('long press e arraste mantêm contato até mover e soltar', () => {
  const action = buildStickerMoveActions({ x: 540, y: 960 }, { x: 350, y: 1139 });
  assert.deepEqual(action[0].actions.map(item => item.type), ['pointerMove', 'pointerDown', 'pause', 'pointerMove', 'pointerUp']);
  assert.equal(action[0].actions[2].duration, 650);
  assert.equal(action[0].actions[3].duration, 900);
});
for (const partial of [false, true]) test(`move isolado confirma posição, somente gesto simples, parcial=${partial}`, async () => {
  const mock = fixture({ partial });
  const result = await moveCurrentCanvasSticker(mock.driver, await mkdtemp('/tmp/sticker-move-'));
  assert.equal(result.position_ok, true); assert.equal(result.published, false);
  assert.equal(mock.gestures.length, partial ? 2 : 1);
  assert.equal(mock.releases(), mock.gestures.length);
  if (partial) assert.notDeepEqual(mock.gestures[1][0].actions[0], mock.gestures[0][0].actions[0], 'centro reacquirido');
});
test('bounds sem mudança abortam antes de repetir gesto ineficaz', async () => {
  const mock = fixture({ stuck: true });
  await assert.rejects(moveCurrentCanvasSticker(mock.driver, await mkdtemp('/tmp/sticker-move-stuck-')), /sem mudança significativa/);
  assert.equal(mock.gestures.length, 1);
});
test('erro técnico libera pointers e não repete', async () => {
  const mock = fixture({ fail: true });
  await assert.rejects(moveCurrentCanvasSticker(mock.driver, await mkdtemp('/tmp/sticker-move-fail-')), /touch failed/);
  assert.equal(mock.gestures.length, 1); assert.equal(mock.releases(), 1);
});
test('objeto ambíguo não recebe nenhum gesto', async () => {
  const mock = fixture({ ambiguous: true });
  await assert.rejects(moveCurrentCanvasSticker(mock.driver, await mkdtemp('/tmp/sticker-move-ambiguous-')), /exatamente um/);
  assert.equal(mock.gestures.length, 0);
});
test('posição já aceita não recebe correções desnecessárias', async () => {
  const mock = fixture({ already: true });
  assert.equal((await moveCurrentCanvasSticker(mock.driver, await mkdtemp('/tmp/sticker-move-ready-'))).position_ok, true);
  assert.equal(mock.gestures.length, 0);
});
for (const factor of [0.6, 1.4]) test(`plano pinch futuro tem dois pointers sincronizados e simétricos, fator=${factor}`, () => {
  const actions = buildStickerPinchActions({ x: 500, y: 700 }, 600, factor);
  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].actions.map(item => [item.type, item.duration]), actions[1].actions.map(item => [item.type, item.duration]));
  for (const index of [0, 3]) {
    assert.equal(actions[0].actions[index].y, 700); assert.equal(actions[1].actions[index].y, 700);
    assert.equal(actions[0].actions[index].x+actions[1].actions[index].x, 1000);
  }
  const start = actions[1].actions[0].x-actions[0].actions[0].x, end = actions[1].actions[3].x-actions[0].actions[3].x;
  assert.equal(end < start, factor < 1);
});
