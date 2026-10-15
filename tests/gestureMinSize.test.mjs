import test from 'node:test';
import assert from 'node:assert/strict';
import {minimumPinchPlan,minimumPinchActions,investigateMinimum,manualMinimumResult} from '../dist/gestureLab/minSize.js';
const snapshot=(w=504)=>({bounds:{left:540-w/2,top:900,right:540+w/2,bottom:1000},canvas:{left:0,top:0,right:1080,bottom:1920},identity:'fixture-sticker',device:'mock'});
function fixture(effect=()=>0,initial=504){
 let current=snapshot(initial);const plans=[],captures=[],events=[];
 return {plans,captures,events,port:{read:async()=>structuredClone(current),capture:async n=>captures.push(n),record:async e=>events.push(e),pinch:async(plan,before)=>{plans.push(plan);current=snapshot(before.bounds.right-before.bounds.left+effect(plan,plans.length));}}};
}
test('three geometries use different real pixel separations, symmetrically inside current sticker',()=>{
 const s=snapshot();const plans=['A','B','C'].map(g=>minimumPinchPlan(s,g,0.25));
 assert.ok(plans[0].finger1_start.x>plans[1].finger1_start.x);assert.ok(plans[1].finger1_start.x>plans[2].finger1_start.x);
 for(const p of plans){assert.equal(p.finger1_start.x+p.finger2_start.x,1080);assert.equal(p.finger1_end.x+p.finger2_end.x,1080);assert.ok(p.finger1_start.x>s.bounds.left);assert.ok(p.finger2_start.x<s.bounds.right);assert.ok(p.finger1_end.x>p.finger1_start.x);assert.ok(p.finger2_end.x<p.finger2_start.x);}
});
test('both pointers remain down in synchronized actions until pinch ends',()=>{
 const actions=minimumPinchActions(minimumPinchPlan(snapshot(),'B',0.25));
 assert.equal(actions.length,2);assert.notEqual(actions[0].id,actions[1].id);
 assert.equal(actions[0].actions.length,actions[1].actions.length);
 for(const p of actions){assert.equal(p.parameters.pointerType,'touch');assert.equal(p.actions[1].type,'pointerDown');assert.equal(p.actions.at(-1).type,'pointerUp');assert.equal(p.actions.filter(a=>a.type==='pointerUp').length,1);}
});
test('three consecutive no effects stop after A/B/C and do not prove physical minimum',async()=>{
 const f=fixture();const r=await investigateMinimum(f.port);
 assert.deepEqual(f.plans.map(p=>p.geometry),['A','B','C']);assert.equal(r.attempts.length,3);
 assert.equal(r.observed_min_width,504);assert.equal(r.MIN_SIZE_LIMIT_OBSERVED,true);
 assert.equal(r.GESTURE_GEOMETRY_LIMIT,false);assert.equal(r.physical_limit_proven,false);
 assert.equal(r.conclusion,'INCONCLUSIVE_WITHOUT_MANUAL_CONTROL');
 assert.ok(f.captures.includes('min-size-3-after'));
});
test('wider geometry breaking 504 records reduction and invalidates minimum hypothesis',async()=>{
 const f=fixture(p=>p.geometry==='C'?-30:0);const r=await investigateMinimum(f.port);
 assert.ok(r.observed_min_width<501);assert.equal(r.MIN_SIZE_LIMIT_OBSERVED,false);assert.equal(r.GESTURE_GEOMETRY_LIMIT,true);
 assert.equal(r.attempts[2].before_width,504);assert.equal(r.attempts[2].after_width,474);
 assert.ok(r.attempts.length<=12);
});
test('every gesture is replanned from fresh shrinking bounds',async()=>{
 const f=fixture(()=>-10,600);const r=await investigateMinimum(f.port);
 assert.equal(r.attempts.length,12);assert.equal(r.observed_min_width,480);
 for(const entry of r.attempts)assert.deepEqual(entry.finger1_start,minimumPinchPlan(entry.before,entry.geometry,entry.strength).finger1_start);
});
test('command error stops and is never a minimum-size finding',async()=>{
 const f=fixture();f.port.pinch=async()=>{throw Error('unsupported');};
 const r=await investigateMinimum(f.port);assert.equal(r.stop_reason,'COMMAND_ERROR');assert.equal(r.attempts.length,1);assert.equal(r.MIN_SIZE_LIMIT_OBSERVED,false);
});
test('manual before/after measures reduction below reference without injecting a gesture',()=>{
 const r=manualMinimumResult(snapshot(504),snapshot(450));assert.equal(r.measurable_reduction,true);assert.equal(r.below_reference,true);assert.equal(r.observed_min_width,450);assert.equal(r.physical_limit_proven,false);
 const unchanged=manualMinimumResult(snapshot(),snapshot());assert.equal(unchanged.measurable_reduction,false);assert.equal(unchanged.conclusion,'INCONCLUSIVE_MANUAL_ATTEMPT');
 assert.throws(()=>manualMinimumResult(snapshot(),{...snapshot(),device:'other'}),/mudou/);
});
