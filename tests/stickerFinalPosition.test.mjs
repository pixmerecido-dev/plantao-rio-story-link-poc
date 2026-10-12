import test,{ after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { positionCurrentSticker } from '../dist/instagram/stickerFinalPosition.js';
import { buildSteppedStickerMoveActions } from '../dist/instagram/stickerTouchActions.js';
const previous = process.env.DRY_RUN; process.env.DRY_RUN = 'true';
after(() => { if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous; });
const desc = 'Sticker. Touch and hold to reposition. Use two fingers to rotate or resize.';
function fixture({ already = false, stuck = false, fail = false, ambiguous = false, changedSize = false } = {}) {
  let box = already ? [83,1094,612,1182] : [500,1094,1029,1182], busy = false, gestures = 0, releases = 0;
  const bounds = () => `[${box[0]},${box[1]}][${box[2]},${box[3]}]`;
  const session = {
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => { assert.equal(busy,false); return `<hierarchy><node resource-id="asset_button" displayed="true"/><node resource-id="com.instagram.android:id/capture_interactive_drawable_container" bounds="[0,0][1080,1920]" displayed="true"><node content-desc="${desc}" class="android.view.View" bounds="${bounds()}" displayed="true"/>${ambiguous ? `<node content-desc="${desc}" bounds="[1,2][10,20]" displayed="true"/>` : ''}</node></hierarchy>`; },
    $$: async () => [{ isExisting: async () => true,isDisplayed: async () => true,getText: async () => '',getAttribute: async key => key === 'bounds' ? bounds() : key === 'content-desc' ? desc : '' }],
    saveScreenshot: async path => writeFile(path,'mock'),pause: async ms => { assert.equal(busy,false); assert.equal(ms,1000); },
    performActions: async actions => {
      busy = true; gestures++;
      assert.deepEqual(actions,buildSteppedStickerMoveActions({ x:764.5,y:1138 },{ x:327.24,y:1138.56 }));
      if (fail) throw new Error('drag timeout');
      if (!stuck) box = changedSize ? [100,1100,550,1170] : [63,1095,592,1183]; busy = false;
    },
    releaseActions: async () => { busy = false; releases++; },
    execute: async () => { throw new Error('não executar resize/ADB'); },elementClick: async () => { throw new Error('não publicar'); },
  };
  return { driver: { getSession: () => session },counts: () => ({ gestures,releases }) };
}
test('bounds já aprovados dentro de 4% terminam sem gesto nem resize',async () => {
  const mock = fixture({ already:true }), dir = await mkdtemp('/tmp/final-position-ready-');
  const result = await positionCurrentSticker(mock.driver,dir);
  assert.equal(result.position_ok,true); assert.equal(result.resized,false); assert.equal(result.published,false);
  assert.deepEqual(mock.counts(),{ gestures:0,releases:0 });
  const report = JSON.parse(await readFile(`${dir}/final-position.json`,'utf8'));
  assert.equal(report.before,'[83,1094][612,1182]'); assert.equal(report.after,report.before);
  assert.equal(report.target_center.x,327.24); assert.equal(report.target_center.y,1138.56);
});
test('posição fora do alvo usa exatamente drag W3C validado e conserva width529',async () => {
  const mock = fixture(), dir = await mkdtemp('/tmp/final-position-move-');
  const result = await positionCurrentSticker(mock.driver,dir);
  assert.equal(result.position_ok,true);
  assert.deepEqual(mock.counts(),{ gestures:1,releases:1 });
  const report = JSON.parse(await readFile(`${dir}/final-position.json`,'utf8'));
  assert.equal(report.after,'[63,1095][592,1183]'); assert.equal(report.gesture_attempts,1);
});
for (const option of ['stuck','fail','changedSize']) test(`resultado não confirmado aborta sem outro gesto: ${option}`,async () => {
  const mock = fixture({ [option]:true }),dir = await mkdtemp('/tmp/final-position-fail-');
  await assert.rejects(positionCurrentSticker(mock.driver,dir),option === 'fail' ? /drag timeout/ : option === 'changedSize' ? /Tamanho mudou/ : /fora da tolerância/);
  assert.deepEqual(mock.counts(),{ gestures:1,releases:1 });
  assert.ok((await readFile(`${dir}/final-position-error.xml`,'utf8')).includes('hierarchy'));
});
test('objeto ambíguo aborta antes do contato',async () => {
  const mock = fixture({ ambiguous:true });
  await assert.rejects(positionCurrentSticker(mock.driver,await mkdtemp('/tmp/final-position-ambiguous-')),/único sticker/);
  assert.deepEqual(mock.counts(),{ gestures:0,releases:0 });
});
