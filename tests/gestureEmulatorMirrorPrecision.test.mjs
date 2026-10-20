import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkMirrorPrecision,mirrorPrecisionTrial,MIRROR_PRECISION_TARGETS} from '../dist/gestureLab/emulatorMirrorPrecision.js';
import {testEmulatorMirrorPinch} from '../dist/gestureLab/emulatorMirrorPinch.js';
import {CURRENT_OBSERVED_LIMIT} from '../dist/admin/stickerSizeLimit.js';
const viewport={x:0,y:0,width:1080,height:2400};
function fixture(initial=217,change=(w,d)=>w+(d==='out'?24:-24)){
 let w=initial;const calls=[];
 const read=async()=>({bounds:{left:539.5-w/2,right:539.5+w/2,top:912,bottom:1006},canvas:{left:0,top:0,right:1080,bottom:1920},identity:'one',device:'emulator-5554'});
 const port={read,capture:async()=>{},record:async()=>{},pinch:async p=>{w=change(w,p.direction);}};
 return {read,calls,run:async(direction,id,expected)=>{if(expected)assert.deepEqual(await read(),expected);calls.push([direction,id]);const r=await testEmulatorMirrorPinch(port,viewport,direction);return {...r,success:r.measured_resize_success,touch_injection:{injection_sequence_observed:true,truncated:false}};}};
}
test('five target rounds qualify only after measured error and injection pass at unchanged four percent',async()=>{
 const p=fixture(),r=await benchmarkMirrorPrecision(p.read,p.run);
 assert.deepEqual(r.targets,[1.1,.9,1.1,.9,1.1]);assert.equal(r.rounds.length,5);assert.equal(r.passed,5);assert.equal(r.qualified,true);assert.equal(r.tolerance,.04);assert.equal(p.calls.length,5);
 let w=217;for(const a of r.rounds){assert.equal(a.initial_width,w);assert.equal(a.requested_target_width,w*a.requested_scale);assert.ok(Math.abs(a.error_percent)<=4);assert.equal(a.iterations.length,1);w=a.final_width;}
 assert.equal(r.mean_absolute_error_percent,r.rounds.reduce((sum,a)=>sum+Math.abs(a.error_percent),0)/5);assert.equal(r.panel_integration,false);assert.equal(r.published,false);
});
test('no effect stops both controller and battery immediately',async()=>{const p=fixture(217,w=>w),r=await benchmarkMirrorPrecision(p.read,p.run);assert.equal(r.qualified,false);assert.equal(p.calls.length,1);assert.equal(r.rounds[0].stop_reason,'NO_EFFECT');assert.equal(r.passed,0);});
test('target stays absolute and controller does not keep pinching after reaching tolerance',async()=>{const p=fixture(217,(w,d)=>w+(d==='out'?5:-5)),r=await mirrorPrecisionTrial(p.read,p.run,1.1,1);assert.equal(p.calls.length,3);assert.equal(r.effective_target_width,217*1.1);assert.equal(r.final_width,232);assert.equal(r.success,true);});
test('overshoot outside tolerance stops without oscillating or pretending precision passed',async()=>{const p=fixture(217,(w,d)=>w+(d==='out'?80:-80)),r=await mirrorPrecisionTrial(p.read,p.run,1.1,1);assert.equal(r.success,false);assert.equal(r.stop_reason,'OVERSHOOT_OUTSIDE_TOLERANCE');assert.equal(p.calls.length,1);assert.ok(Math.abs(r.error_percent)>4);});
test('injection failure cannot qualify even when width lands within tolerance',async()=>{const p=fixture(),r=await mirrorPrecisionTrial(p.read,async(...args)=>{const a=await p.run(...args);return {...a,touch_injection:{injection_sequence_observed:false,truncated:false}};},1.1,1);assert.equal(r.success,false);assert.equal(r.stop_reason,'INJECTION_NOT_CONFIRMED');});
test('known minimum is scoped to Veja; standard 504 never leaks into this profile',async()=>{
 const p=fixture(213),standard=await mirrorPrecisionTrial(p.read,p.run,.9,1,CURRENT_OBSERVED_LIMIT);assert.equal(standard.observed_min_width,null);assert.equal(standard.clamped,false);assert.equal(standard.effective_target_width,213*.9);
 const limit={...CURRENT_OBSERVED_LIMIT,scope:{...CURRENT_OBSERVED_LIMIT.scope,text:'Veja'},observed_min_width:213};const q=fixture(213),r=await mirrorPrecisionTrial(q.read,q.run,.9,1,limit);assert.equal(r.effective_target_width,213);assert.equal(r.clamped,true);assert.equal(r.clamp_reason,'INSTAGRAM_MIN_SIZE');assert.equal(r.gesture_skipped,true);assert.equal(q.calls.length,0);assert.equal(r.success,true);
});
test('unexpected input changes stop before a gesture and invalid scales are rejected',async()=>{
 const p=fixture();let reads=0;const changing=async()=>{const s=await p.read();if(++reads>1)s.bounds.left++;return s;};await assert.rejects(mirrorPrecisionTrial(changing,p.run,1.1,1),/Estado mudou/);assert.equal(p.calls.length,0);await assert.rejects(mirrorPrecisionTrial(p.read,p.run,.8,1),/±10%/);
});
