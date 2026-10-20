import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmSessionMinimum,sessionPrecisionLimit} from '../dist/gestureLab/sessionMinimum.js';
import {benchmarkMirrorPrecision} from '../dist/gestureLab/emulatorMirrorPrecision.js';
import {CURRENT_OBSERVED_LIMIT} from '../dist/admin/stickerSizeLimit.js';
import {testEmulatorMirrorPinch} from '../dist/gestureLab/emulatorMirrorPinch.js';
const scope={...CURRENT_OBSERVED_LIMIT.scope};
function snapshot(w=575){return {bounds:{left:540-w/2,right:540+w/2,top:912,bottom:1006},canvas:{left:0,top:0,right:1080,bottom:1920},identity:'one',device:'emulator-5554'};}
function evidence(){return {kind:'mirror-convergence-575-548',success:false,stop_reason:'ATTEMPT_LIMIT',initial_width:575,final_width:575,attempts:[.8,1/1.3,1/1.35].map(factor=>({before:snapshot(),after:snapshot(),direction:'in',command_error:null,valid:true,delta_width:0,context:{text_declared_by_operator:scope.text,style_index:0,instagram_version:null},touch_injection:{injection_sequence_observed:true,truncated:false},plan:{distance_factor:factor}}))};}
const observation=()=>confirmSessionMinimum(evidence(),snapshot(),scope,'source.json','digest');
test('manual observation preserves historical limit and remains bound to exact measured state',()=>{
 const o=observation();assert.equal(o.observed_min_width,575);assert.equal(o.session_only,true);assert.equal(CURRENT_OBSERVED_LIMIT.observed_min_width,504);
 assert.equal(sessionPrecisionLimit(o,snapshot(),scope.text).observed_min_width,575);
 assert.throws(()=>sessionPrecisionLimit(o,snapshot(576),scope.text),/estado inicial/);
 assert.throws(()=>sessionPrecisionLimit(o,snapshot(),'Veja'),/estado inicial/);
});
test('rejects incomplete stall, invalid injection, changed version and different live bounds',()=>{
 for(const mutate of [d=>d.attempts.pop(),d=>d.attempts[0].touch_injection.injection_sequence_observed=false,d=>d.attempts[0].context.instagram_version='new',d=>d.attempts[1].after.bounds.left++]){
  const d=evidence();mutate(d);assert.throws(()=>confirmSessionMinimum(d,snapshot(),scope,'source','digest'));
 }
 assert.throws(()=>confirmSessionMinimum(evidence(),snapshot(574),scope,'source','digest'));
});
test('session battery skips two clamped reductions before increasing, with original tolerance',async()=>{
 let w=575;const calls=[];const read=async()=>snapshot(w);
 const run=async(direction)=>{calls.push(direction);const r=await testEmulatorMirrorPinch({read,capture:async()=>{},record:async()=>{},pinch:async()=>{w=direction==='out'?w*1.1:Math.max(575,w*.9);}},{x:0,y:0,width:1080,height:2400},direction);return {...r,success:r.measured_resize_success,touch_injection:{injection_sequence_observed:true,truncated:false}};};
 const r=await benchmarkMirrorPrecision(read,run,CURRENT_OBSERVED_LIMIT,async()=>{},scope.text,true,observation());
 assert.equal(r.qualified,true);assert.equal(r.rounds[0].clamped,true);assert.equal(r.rounds[1].clamped,true);assert.equal(r.rounds[0].gesture_skipped,true);assert.equal(r.rounds[1].gesture_skipped,true);assert.equal(r.rounds[2].initial_width,575);assert.deepEqual(calls,['out','in','out']);assert.equal(r.tolerance,.04);
});
test('manual confirmation accepts only narrow vertical settling with identical horizontal bounds',()=>{
 const fresh=snapshot();fresh.bounds.top-=4;fresh.bounds.bottom+=3;
 const o=confirmSessionMinimum(evidence(),fresh,scope,'source','digest');
 assert.equal(o.vertical_bounds_changed,true);assert.deepEqual(o.source_snapshot,snapshot());assert.deepEqual(o.reference_snapshot,fresh);assert.equal(o.observed_min_width,575);
 const moved=snapshot();moved.bounds.top-=5;assert.throws(()=>confirmSessionMinimum(evidence(),moved,scope,'source','digest'));
 const shifted=snapshot();shifted.bounds.left++;shifted.bounds.right++;assert.throws(()=>confirmSessionMinimum(evidence(),shifted,scope,'source','digest'));
});
