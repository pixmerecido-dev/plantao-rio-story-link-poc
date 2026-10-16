import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CURRENT_LIMIT_SCOPE,CURRENT_OBSERVED_LIMIT,findObservedLimit,panelObservedLimit,minimumScale,clampScale} from '../dist/admin/stickerSizeLimit.js';
import {ObservedSizeLimitStore} from '../dist/gestureLab/sizeLimitStore.js';
import {resizeTrial,benchmarkResize} from '../dist/gestureLab/core.js';
import {estimateStickerPreview,applyStickerPreview} from '../dist/admin/stickerPreview.js';
import {StorySettingsService} from '../dist/admin/storySettingsService.js';
import {JsonStorage} from '../dist/admin/jsonStorage.js';
import {defaultSettings} from '../dist/admin/domain.js';
const known=structuredClone(CURRENT_OBSERVED_LIMIT);
function port(initial=504){
 let w=initial,calls=0;
 return {count:()=>calls,read:async()=>({bounds:{left:540-w/2,top:900,right:540+w/2,bottom:1000},canvas:{left:0,top:0,right:1080,bottom:1920},identity:'fixture',device:'emulator-5554'}),capture:async()=>{},record:async()=>{},move:async()=>{throw Error('MOVE forbidden');},resize:async(_method,_b,factor)=>{calls++;w=Math.max(504,w*factor);}};
}
test('minimum is keyed by exact text, style, canvas, device and optional version',()=>{
 assert.equal(findObservedLimit([known],CURRENT_LIMIT_SCOPE).observed_min_width,504);
 for(const patch of [{text:'Outro texto'},{text:'LEIA A MATÉRIA COMPLETA'},{style_index:1},{canvas_width:720},{canvas_height:2400},{device:'other'},{instagram_version:'new-version'}])assert.equal(findObservedLimit([known],{...CURRENT_LIMIT_SCOPE,...patch}),undefined);
 assert.ok(Math.abs(minimumScale(known)-0.6932599724896836)<1e-12);
 assert.equal(clampScale(0.60,known),minimumScale(known));assert.equal(clampScale(0.80,known),0.80);
});
test('validated current observation persists and can be recalibrated without universal fallback',async()=>{
 const path=join(await mkdtemp('/tmp/sticker-min-'),'limits.json'),store=new ObservedSizeLimitStore(path);
 assert.equal((await store.load())[0].observed_min_width,504);
 assert.ok((await new ObservedSizeLimitStore(path).load())[0].recorded_at);
 await store.save({...known,scope:{...known.scope,instagram_version:'future'},observed_min_width:490});
 const limits=await new ObservedSizeLimitStore(path).load();assert.equal(limits.length,2);
 assert.equal(findObservedLimit(limits,{...known.scope,instagram_version:'future'}).observed_min_width,490);
 assert.equal(JSON.parse(await readFile(path,'utf8')).version,1);
});
test('target below validated minimum is clamped and accepted at 504 without a pinch',async()=>{
 const p=port();const r=await resizeTrial(p,0.8,'NATIVE','clamped',known);
 assert.equal(r.requested_target_width,403.20000000000005);assert.equal(r.effective_target_width,504);
 assert.equal(r.TARGET_BELOW_MIN,true);assert.equal(r.clamped,true);assert.equal(r.reason,'INSTAGRAM_MIN_SIZE');
 assert.equal(r.success,true);assert.equal(r.error_percent,0);assert.equal(p.count(),0);
});
test('unvalidated configuration keeps original target and does not claim clamp',async()=>{
 const p=port();const r=await resizeTrial(p,0.8,'NATIVE','unknown');
 assert.equal(r.observed_min_width,null);assert.equal(r.clamped,false);assert.equal(r.success,false);
});
test('clamp is not automatic success if final width is outside effective tolerance',async()=>{
 const p=port(542);p.resize=async()=>{};
 const r=await resizeTrial(p,0.8,'NATIVE','stuck',known);
 assert.equal(r.clamped,true);assert.equal(r.success,false);assert.ok(r.error_percent>4);
});
test('five simulated rounds include clamped targets and retain both measured pinch directions',async()=>{
 const p=port();const r=await benchmarkResize(p,'NATIVE',known);
 assert.equal(r.passed,5);assert.equal(r.qualified,true);assert.ok(r.clamped_count>=1);
 assert.equal(r.PINCH_IN_SUPPORTED,true);assert.equal(r.PINCH_OUT_SUPPORTED,true);
 assert.ok(r.rounds.every(x=>Math.abs(x.error_percent)<=4));
});
test('preview uses measured reference width and never renders known text below minimum',()=>{
 const r=estimateStickerPreview(known.scope.text,0.6,known);assert.equal(r.width_px,504);
 const fake={style:{},dataset:{},querySelector:()=>null};
 applyStickerPreview(fake,known.scope.text,0.6,1080,known);
 assert.equal(fake.dataset.scale,String(504/727));assert.equal(fake.style.width,'727px');
 assert.equal(panelObservedLimit([known],'Other',0),undefined);
});
test('server settings service clamps saved scale while other text remains unrestricted',async()=>{
 const root=await mkdtemp('/tmp/size-settings-');const repository=new JsonStorage(join(root,'admin.json'));
 const service=new StorySettingsService(repository,new ObservedSizeLimitStore(join(root,'limits.json')));
 const settings=defaultSettings();settings.story.sticker.scale=0.6;
 const saved=await service.save(settings);assert.equal(saved.story.sticker.scale,504/727);
 assert.equal((await repository.getSettings()).story.sticker.scale,504/727);
 settings.story.sticker.text='Outro texto';settings.story.sticker.scale=0.6;
 assert.equal((await service.save(settings)).story.sticker.scale,0.6);
});
