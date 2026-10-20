import test from 'node:test';
import assert from 'node:assert/strict';
import {SHORT_TOUCH_RECIPES,shortTouchActions,investigateShortTouch,validateSynchronizedTouchActions} from '../dist/gestureLab/shortTouchExecution.js';
import {anchorPlan} from '../dist/gestureLab/anchorCalibration.js';
import {FROZEN_RESIZE_ANCHORS} from '../dist/gestureLab/anchorTextValidation.js';
function port(effect){let w=265,x=540;const calls=[],records=[];return {calls,records,read:async()=>({bounds:{left:x-w/2,right:x+w/2,top:901,bottom:1017},canvas:{left:0,top:0,right:1080,bottom:1920},identity:'one',device:'emulator-5554'}),capture:async()=>{},mark:async n=>`${n}.svg`,record:async r=>records.push(r),pinch:async(p,b,recipe)=>{calls.push({p,recipe});const next=effect(w,p.direction,recipe);w=next.width??w;x+=next.drift??0;}};}
test('only continuous simultaneous entry remains; coordinates and endpoints stay frozen',async()=>{
 const p=port(()=>({})),plan=anchorPlan(await p.read(),FROZEN_RESIZE_ANCHORS,'out');
 assert.equal(SHORT_TOUCH_RECIPES.length,1);
 const [red,green]=shortTouchActions(plan,SHORT_TOUCH_RECIPES[0]);
 assert.equal(red.actions.length,green.actions.length);assert.equal(red.actions[1].type,'pointerDown');assert.equal(green.actions[1].type,'pointerDown');
 assert.ok(!red.actions.some(a=>a.type==='pause'));assert.ok(!green.actions.some(a=>a.type==='pause'));
 assert.equal(red.actions[0].x,plan.finger1_start.x);assert.equal(green.actions.at(-2).x,plan.finger2_end.x);
 assert.deepEqual(red.actions.map(a=>a.duration??0),green.actions.map(a=>a.duration??0));
 validateSynchronizedTouchActions([red,green]);
});
test('ignored synchronized gesture stops without retries or reduction',async()=>{
 const p=port(()=>({})),r=await investigateShortTouch(p);assert.equal(p.calls.length,1);assert.equal(r.attempts.length,1);assert.equal(r.stop_reason,'SIMULTANEOUS_NO_EFFECT');assert.equal(r.SHORT_AUTOMATED_SUCCESS,false);assert.equal(r.sequential_entry_disabled,true);assert.equal(r.attempts[0].execution_status,'NO_EFFECT_OR_INVALID_DRIFT');
});
test('working synchronized gesture is tested only once in reverse with fresh bounds',async()=>{
 const p=port((w,d)=>({width:w+(d==='out'?50:-40)})),r=await investigateShortTouch(p);
 assert.deepEqual(p.calls.map(c=>c.p.direction),['out','in']);assert.equal(r.SHORT_AUTOMATED_SUCCESS,true);assert.equal(r.preferred_recipe.id,'SIMULTANEOUS_CONTINUOUS');assert.equal(r.attempts[1].before_width,315);assert.equal(r.attempts[1].after_width,275);
});
test('sequential entries, duplicate sources and missing UP are rejected before injection',async()=>{
 const p=port(()=>({})),plan=anchorPlan(await p.read(),FROZEN_RESIZE_ANCHORS,'out');
 const original=shortTouchActions(plan,SHORT_TOUCH_RECIPES[0]);
 const delayed=structuredClone(original);delayed[1].actions.splice(1,0,{type:'pause',duration:80});assert.throws(()=>validateSynchronizedTouchActions(delayed));
 const duplicate=structuredClone(original);duplicate[1].id=duplicate[0].id;assert.throws(()=>validateSynchronizedTouchActions(duplicate));
 const missing=structuredClone(original);for(const s of missing)s.actions.pop();assert.throws(()=>validateSynchronizedTouchActions(missing));
 assert.throws(()=>shortTouchActions(plan,{id:'RED_FIRST',first:'red',entry_delay_ms:80,hold_ms:150,step_ms:150,steps:5}));
 const repeated=structuredClone(original);for(const s of repeated)s.actions.splice(2,0,{type:'pointerDown',button:0});assert.throws(()=>validateSynchronizedTouchActions(repeated));
});
test('out-only effect is not both-direction approval',async()=>{const p=port((w,d)=>d==='out'?{width:w+50}:{}),r=await investigateShortTouch(p);assert.equal(p.calls.length,2);assert.equal(r.SHORT_AUTOMATED_SUCCESS,false);assert.ok(r.candidate_out_recipe);assert.equal(r.preferred_recipe,null);assert.equal(r.stop_reason,'PINCH_IN_NOT_CONFIRMED');});
test('drift or command error stops immediately even when width changes',async()=>{const p=port(w=>({width:w+50,drift:30})),r=await investigateShortTouch(p);assert.equal(p.calls.length,1);assert.equal(r.stop_reason,'INVALID_DRIFT');assert.equal(r.SHORT_AUTOMATED_SUCCESS,false);const q=port(()=>({}));q.pinch=async()=>{throw Error('driver');};const f=await investigateShortTouch(q);assert.equal(f.attempts.length,1);assert.equal(f.stop_reason,'COMMAND_ERROR');});
test('unexpected reduction during out does not trigger a new recipe',async()=>{const p=port(w=>({width:w-10})),r=await investigateShortTouch(p);assert.equal(p.calls.length,1);assert.equal(r.stop_reason,'WRONG_DIRECTION');assert.equal(r.SHORT_AUTOMATED_SUCCESS,false);});
