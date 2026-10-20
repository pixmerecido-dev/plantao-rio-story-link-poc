import test from 'node:test';
import assert from 'node:assert/strict';
import {repeatEmulatorMirrorCycles} from '../dist/gestureLab/emulatorMirrorCycles.js';
import {testEmulatorMirrorPinch} from '../dist/gestureLab/emulatorMirrorPinch.js';
const viewport={x:0,y:0,width:1080,height:2400};
function fixture(change=(w,d)=>w+(d==='out'?24:-24)){
 let w=213,x=539.5;const calls=[];
 const read=async()=>({bounds:{left:x-w/2,right:x+w/2,top:912,bottom:1006},canvas:{left:0,top:0,right:1080,bottom:1920},identity:'one',device:'emulator-5554'});
 const port={read,capture:async()=>{},record:async()=>{},pinch:async p=>{const next=change(w,p.direction);if(typeof next==='object'){w=next.w;x+=next.drift??0;}else w=next;}};
 return {calls,run:async(direction,cycle,expected)=>{
  if(expected)assert.deepEqual(await read(),expected);
  calls.push([direction,cycle]);
  const r=await testEmulatorMirrorPinch(port,viewport,direction);
  return {...r,success:r.measured_resize_success,touch_injection:{injection_sequence_observed:true,truncated:false}};
 }};
}
test('five measured out/in cycles qualify repeatability only, with fresh continuity between all ten gestures',async()=>{
 const p=fixture(),progress=[],r=await repeatEmulatorMirrorCycles(p.run,async r=>progress.push(r));
 assert.equal(p.calls.length,10);assert.deepEqual(p.calls.slice(0,4),[['out',1],['in',1],['out',2],['in',2]]);
 assert.equal(r.passed,5);assert.equal(r.total,5);assert.equal(r.qualified,true);assert.equal(r.mean_absolute_return_error_percent,0);
 for(const c of r.rounds){assert.equal(c.increase.before_width,213);assert.equal(c.increase.after_width,237);assert.equal(c.decrease.after_width,213);}
 assert.deepEqual(progress.map(r=>r.qualified),[false,false,false,false,true]);assert.equal(r.exact_target_benchmark_executed,false);assert.equal(r.panel_integration,false);assert.equal(r.published,false);
});
test('no-effect increase stops before reduction and never retries',async()=>{
 const p=fixture(w=>w),r=await repeatEmulatorMirrorCycles(p.run);assert.equal(p.calls.length,1);assert.equal(r.qualified,false);assert.equal(r.rounds[0].decrease,null);assert.equal(r.passed,0);
});
test('failed inward effect stops after the first pair',async()=>{
 const p=fixture((w,d)=>d==='out'?w+24:w),r=await repeatEmulatorMirrorCycles(p.run);assert.equal(p.calls.length,2);assert.equal(r.qualified,false);assert.equal(r.rounds.length,1);
});
test('accepted geometry without injection proof cannot qualify or advance',async()=>{
 const p=fixture(),r=await repeatEmulatorMirrorCycles(async(...args)=>{const v=await p.run(...args);return {...v,touch_injection:{injection_sequence_observed:false,truncated:false}};});assert.equal(p.calls.length,1);assert.equal(r.qualified,false);
 const q=fixture(),truncated=await repeatEmulatorMirrorCycles(async(...args)=>{const v=await q.run(...args);return {...v,touch_injection:{injection_sequence_observed:true,truncated:true}};});assert.equal(q.calls.length,1);assert.equal(truncated.qualified,false);
});
test('cumulative position drift stops qualification even when individual drifts are small',async()=>{
 const p=fixture((w,d)=>({w:w+(d==='out'?24:-24),drift:5})),r=await repeatEmulatorMirrorCycles(p.run);assert.equal(r.qualified,false);assert.ok(p.calls.length<10);assert.ok(r.rounds.at(-1).success===false);
});
