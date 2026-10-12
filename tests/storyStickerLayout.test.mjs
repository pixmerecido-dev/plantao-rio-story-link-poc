import test,{ after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { applyApprovedStoryLayout } from '../dist/instagram/storyStickerLayout.js';
import { beginCurrentLinkTransaction,confirmCurrentLinkTransaction,requireCurrentLinkTransaction } from '../dist/instagram/appliedLinkSticker.js';
import { requireApprovedStickerLayout } from '../dist/instagram/approvedStickerLayout.js';
const previous = process.env.DRY_RUN; process.env.DRY_RUN = 'true';
after(() => { if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous; });
const desc = 'Sticker. Touch and hold to reposition. Use two fingers to rotate or resize.';
function fixture({ already = false, needMove = false, excessive = false, stuckMove = false, timeout = false } = {}) {
  let sticker = false, bounds = already ? '[83,1094][612,1182]' : '[0,1080][696,1196]';
  const events = [];
  const session = {
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => `<hierarchy><node resource-id="asset_button" displayed="true"/><node resource-id="com.instagram.android:id/capture_interactive_drawable_container" bounds="[0,0][1080,1920]" displayed="true">${sticker ? `<node content-desc="${desc}" class="android.view.View" bounds="${bounds}" displayed="true"/>` : ''}</node></hierarchy>`,
    $$: async selector => sticker && selector === `~${desc}` ? [{ isExisting:async () => true,isDisplayed:async () => true,getText:async () => '',getAttribute:async key => key === 'bounds' ? bounds : key === 'content-desc' ? desc : '' }] : [],
    pause:async ms => assert.equal(ms,1000),saveScreenshot:async path => writeFile(path,'mock'),
    execute:async (command,args) => {
      events.push('resize'); assert.equal(command,'mobile: pinchCloseGesture');
      assert.deepEqual(args,{ left:0,top:1080,width:696,height:116,percent:0.50 });
      if (timeout) throw new Error('native timeout');
      bounds = excessive ? '[140,1105][540,1171]' : needMove ? '[400,1094][929,1182]' : '[83,1094][612,1182]';
    },
    performActions:async pointers => {
      events.push('move'); assert.equal(pointers.length,1);
      const [pointer] = pointers;
      assert.equal(pointer.actions[2].duration,900);
      assert.equal(pointer.actions.filter(action => action.type === 'pointerMove').length,6);
      if (!stuckMove) bounds = '[63,1095][592,1183]';
    },releaseActions:async () => {},
    elementClick:async () => { throw new Error('nunca publicar na preparação'); },
  };
  return { driver:{ getSession:() => session },events,changeBounds: value => { bounds = value; },confirm:async () => {
    await beginCurrentLinkTransaction(session,'layout-job','https://example.org/','Leia a matéria completa'); sticker = true;
    assert.equal(await confirmCurrentLinkTransaction(session,{ jobId:'layout-job',url:'https://example.org/',stickerText:'Leia a matéria completa' }),true);
  } };
}
for (const options of [{},{ already:true },{ needMove:true }]) test(`layout reutiliza gestos reais em ordem e pula ajustes desnecessários: ${JSON.stringify(options)}`,async () => {
  const mock = fixture(options); await mock.confirm();
  const result = await applyApprovedStoryLayout(mock.driver,'layout-job',await mkdtemp('/tmp/story-layout-'));
  assert.equal(result.layout_confirmed,true); assert.equal(result.size_ok,true); assert.equal(result.position_ok,true);
  assert.deepEqual(mock.events,options.already ? [] : options.needMove ? ['resize','move'] : ['resize']);
  assert.equal(await requireCurrentLinkTransaction(mock.driver.getSession(),'layout-job'),'layout-job');
  await requireApprovedStickerLayout(mock.driver.getSession(),'layout-job');
});
for (const options of [{ excessive:true },{ needMove:true,stuckMove:true },{ timeout:true }]) test(`layout não aprovado invalida transação e impede publicação: ${JSON.stringify(options)}`,async () => {
  const mock = fixture(options); await mock.confirm();
  await assert.rejects(applyApprovedStoryLayout(mock.driver,'layout-job',await mkdtemp('/tmp/story-layout-fail-')));
  await assert.rejects(requireApprovedStickerLayout(mock.driver.getSession(),'layout-job'));
  assert.ok(mock.events.length <= 2);
});
test('aprovação não acompanha outro job e mudança posterior invalida publicação',async () => {
  const mock = fixture({ already:true }); await mock.confirm();
  await applyApprovedStoryLayout(mock.driver,'layout-job',await mkdtemp('/tmp/story-layout-ready-'));
  await assert.rejects(requireApprovedStickerLayout(mock.driver.getSession(),'other-job'));
  mock.changeBounds('[400,1094][929,1182]');
  await assert.rejects(requireApprovedStickerLayout(mock.driver.getSession(),'layout-job'));
});
test('sem layout confirmado no job não libera publicação, mesmo com Link aplicado',async () => {
  const mock = fixture({ already:true }); await mock.confirm();
  await assert.rejects(requireApprovedStickerLayout(mock.driver.getSession(),'layout-job'),/layout_confirmed=false/);
  assert.deepEqual(mock.events,[]);
});
