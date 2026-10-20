import test from 'node:test';
import assert from 'node:assert/strict';
import {emulatorMirrorPlan,emulatorMirrorActions,testEmulatorMirrorPinch} from '../dist/gestureLab/emulatorMirrorPinch.js';
const viewport={x:0,y:0,width:1080,height:2400};
function snapshot(){return {bounds:{left:407,top:901,right:672,bottom:1017},canvas:{left:0,top:0,right:1080,bottom:1920},identity:'one',device:'emulator-5554'};}
function port(change){let s=snapshot();const calls=[],records=[];return {calls,records,read:async()=>structuredClone(s),capture:async()=>{},record:async r=>records.push(r),pinch:async p=>{calls.push(p);s=change(s);}};}
test('inside point follows live sticker; outside point mirrors screen center, not sticker center',()=>{
 const s=snapshot(),p=emulatorMirrorPlan(s,viewport);
 assert.deepEqual(p.center,{x:540,y:1200});assert.deepEqual(p.finger1_start,{x:659,y:935});assert.deepEqual(p.finger2_start,{x:421,y:1465});
 assert.deepEqual(p.finger1_end,{x:683,y:882});assert.deepEqual(p.finger2_end,{x:397,y:1518});
 assert.ok(p.finger2_start.y>s.bounds.bottom);assert.equal(p.finger1_start.x+p.finger2_start.x,1080);assert.equal(p.finger1_end.y+p.finger2_end.y,2400);assert.ok(Math.abs(p.planned_angle_delta_degrees)<.1);
 const other=snapshot();other.bounds={left:400,top:910,right:640,bottom:1010};assert.notDeepEqual(emulatorMirrorPlan(other,viewport).finger1_start,p.finger1_start);
});
test('two sources enter and leave together with no single-pointer pause or click sequence',()=>{
 const p=emulatorMirrorPlan(snapshot(),viewport),[a,b]=emulatorMirrorActions(p);
 assert.equal(a.actions.length,b.actions.length);assert.equal(a.actions[1].type,'pointerDown');assert.equal(b.actions[1].type,'pointerDown');assert.equal(a.actions.at(-1).type,'pointerUp');assert.ok(!a.actions.some(a=>a.type==='pause'));assert.equal(a.actions.at(-2).x,p.finger1_end.x);assert.equal(b.actions.at(-2).y,p.finger2_end.y);
});
test('one increase only, with before/after measurement; no automatic reversal or search',async()=>{
 const p=port(s=>{s.bounds.left-=25;s.bounds.right+=25;return s;}),r=await testEmulatorMirrorPinch(p,viewport);
 assert.equal(p.calls.length,1);assert.equal(r.before_width,265);assert.equal(r.after_width,315);assert.equal(r.center_drift,0);assert.equal(r.measured_resize_success,true);assert.equal(r.geometry_qualification,'NOT_EVALUATED');assert.equal(r.benchmark_executed,false);assert.equal(r.published,false);
});
test('wrong direction, unchanged width, drift and command error never become resize success',async()=>{
 for(const change of [s=>s,s=>{s.bounds.right-=10;return s;},s=>{s.bounds.right+=100;return s;}]){const p=port(change),r=await testEmulatorMirrorPinch(p,viewport);assert.equal(r.measured_resize_success,false);assert.equal(p.calls.length,1);}
 const q=port(s=>s);q.pinch=async()=>{throw Error('driver');};const r=await testEmulatorMirrorPinch(q,viewport);assert.equal(r.measured_resize_success,false);assert.ok(r.command_error);
});
test('unsafe reflected point or viewport is rejected before any touch',async()=>{
 const bad=snapshot();bad.bounds={left:400,right:665,top:100,bottom:216};assert.throws(()=>emulatorMirrorPlan(bad,viewport),/canvas seguro/);
 assert.throws(()=>emulatorMirrorPlan(snapshot(),{...viewport,width:NaN}));
 const p=port(s=>s);p.read=async()=>bad;await assert.rejects(testEmulatorMirrorPinch(p,viewport));assert.equal(p.calls.length,0);
});

test('inward plan converges both contacts along same axis without changing outward behavior',()=>{
 const s=snapshot(),out=emulatorMirrorPlan(s,viewport),inward=emulatorMirrorPlan(s,viewport,'in');
 assert.deepEqual(inward.finger1_start,out.finger1_start);assert.deepEqual(inward.finger2_start,out.finger2_start);
 const distance=p=>Math.hypot(p.finger1_end.x-p.finger2_end.x,p.finger1_end.y-p.finger2_end.y);
 const start=Math.hypot(inward.finger1_start.x-inward.finger2_start.x,inward.finger1_start.y-inward.finger2_start.y);
 assert.ok(distance(inward)<start);assert.ok(distance(out)>start);assert.equal(inward.direction,'in');assert.equal(inward.distance_factor,1/1.2);
 assert.equal(inward.finger1_end.x+inward.finger2_end.x,1080);assert.equal(inward.finger1_end.y+inward.finger2_end.y,2400);assert.ok(Math.abs(inward.planned_angle_delta_degrees)<1);
});
test('single inward trial accepts only measured reduction and never retries at a minimum',async()=>{
 const p=port(s=>{s.bounds.left+=10;s.bounds.right-=10;return s;}),r=await testEmulatorMirrorPinch(p,viewport,'in');
 assert.equal(p.calls.length,1);assert.equal(p.calls[0].direction,'in');assert.equal(r.direction,'in');assert.equal(r.before_width,265);assert.equal(r.after_width,245);assert.equal(r.measured_resize_success,true);
 const q=port(s=>s),noEffect=await testEmulatorMirrorPinch(q,viewport,'in');assert.equal(q.calls.length,1);assert.equal(noEffect.measured_resize_success,false);
 const wrong=port(s=>{s.bounds.left-=10;s.bounds.right+=10;return s;}),bad=await testEmulatorMirrorPinch(wrong,viewport,'in');assert.equal(bad.measured_resize_success,false);
});
