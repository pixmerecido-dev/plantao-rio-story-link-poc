import test from 'node:test';
import assert from 'node:assert/strict';
import {anchorPlan,anchorGrid,anchorActions,anchorMetrics,calibrateAnchors,REFERENCE_ANCHORS} from '../dist/gestureLab/anchorCalibration.js';
import {annotatedAnchorScreenshot} from '../dist/gestureLab/anchorScreenshot.js';
function snap(w=526){return {bounds:{left:249,top:952,right:249+w,bottom:1040},canvas:{left:0,top:0,right:1080,bottom:1920},identity:'one',device:'emulator-5554'};}
function port(effect){let s=snap(),n=0;const calls=[],records=[];return {calls,records,read:async()=>structuredClone(s),capture:async()=>{},mark:async name=>`${name}-anchors.svg`,record:async r=>records.push(r),pinch:async p=>{calls.push(p);s=effect(structuredClone(s),p,++n);}};}
function resize(s,delta){s.bounds.left-=delta/2;s.bounds.right+=delta/2;return s;}
test('reference anchors use live width AND height; no absolute anchor coordinates',()=>{
 const a=anchorPlan(snap(),REFERENCE_ANCHORS,'in');assert.deepEqual(a.red,{x:749,y:978});assert.deepEqual(a.green,{x:270,y:1014});
 for(const w of [300,526,727]){const s=snap(w),p=anchorPlan(s,REFERENCE_ANCHORS,'in');assert.equal(p.red.x,Math.round(s.bounds.left+w*.95));assert.equal(p.green.x,Math.round(s.bounds.left+w*.04));assert.notEqual(p.finger1_start.x,p.finger1_end.x);assert.equal(p.red.y,978);}
 const tall=snap();tall.bounds.bottom=1152;assert.equal(anchorPlan(tall,REFERENCE_ANCHORS,'in').red.y,1010);
});
test('in and out reverse the same calculated diagonal; touch ticks synchronized',()=>{
 const a=anchorPlan(snap(),REFERENCE_ANCHORS,'in'),b=anchorPlan(snap(),REFERENCE_ANCHORS,'out');
 assert.deepEqual(a.finger1_start,b.finger1_end);assert.deepEqual(a.finger1_end,b.finger1_start);assert.deepEqual(a.finger2_start,b.finger2_end);assert.deepEqual(a.finger2_end,b.finger2_start);
 const [p,q]=anchorActions(a);assert.equal(p.parameters.pointerType,'touch');assert.deepEqual(p.actions.map(a=>[a.type,a.duration]),q.actions.map(a=>[a.type,a.duration]));assert.equal(p.actions.at(-2).x,a.finger1_end.x);assert.equal(p.actions.at(-2).y,a.finger1_end.y);
});
test('local grid starts centered and changes exactly one percentage per neighbor',()=>{
 const grid=anchorGrid();assert.equal(grid.length,9);assert.equal(new Set(grid.map(JSON.stringify)).size,9);assert.deepEqual(grid[0],REFERENCE_ANCHORS);
 for(const a of grid.slice(1)){let differences=0;for(const color of ['red','green'])for(const axis of ['x','y'])differences+=a[color][axis]!==REFERENCE_ANCHORS[color][axis];assert.equal(differences,1);}
});
test('no effect finishes bounded search with no fabricated support',async()=>{
 const p=port(s=>s),r=await calibrateAnchors(p);assert.equal(p.calls.length,18);assert.equal(r.PINCH_IN_EFFECTIVE,false);assert.equal(r.PINCH_OUT_EFFECTIVE,false);assert.equal(r.preferred_anchors,null);assert.equal(r.lowest_width_reached,526);assert.ok(r.attempts.every(a=>a.no_effect&&!a.success));assert.equal(p.records.filter(a=>a.phase==='COMMAND').length,18);
});
test('measured diagonal reduction then increase yield candidate; fresh bounds recalculate pixels',async()=>{
 const p=port((s,plan)=>resize(s,plan.direction==='in'?-20:20)),r=await calibrateAnchors(p);assert.equal(p.calls.length,2);assert.equal(r.PINCH_IN_EFFECTIVE,true);assert.equal(r.PINCH_OUT_EFFECTIVE,true);assert.deepEqual(r.preferred_anchors,REFERENCE_ANCHORS);assert.equal(r.attempts[0].delta_width,-20);assert.equal(r.attempts[1].delta_width,20);assert.equal(r.attempts[1].before_width,506);assert.notEqual(r.attempts[0].red_anchor_px.x,r.attempts[1].red_anchor_px.x);assert.ok(r.attempts.every(a=>a.center_drift===0));
});
test('out tries proven in percentages first, then avoids wrong-direction approval',async()=>{
 const p=port((s,plan)=>plan.percent.red.x===.93?resize(s,plan.direction==='in'?-10:10):s),r=await calibrateAnchors(p);assert.equal(r.attempts.length,3);assert.equal(r.attempts[2].direction,'out');assert.equal(r.attempts[2].red_anchor_percent.x,.93);assert.equal(r.PINCH_OUT_EFFECTIVE,true);
 const q=port(s=>resize(s,10)),bad=await calibrateAnchors(q);assert.equal(bad.stop_reason,'WRONG_DIRECTION');assert.equal(q.calls.length,1);assert.equal(bad.PINCH_IN_EFFECTIVE,false);
});
test('drift, command failures and identity changes invalidate rather than approve',async()=>{
 const p=port(s=>{resize(s,-10);s.bounds.left+=30;s.bounds.right+=30;return s;}),r=await calibrateAnchors(p);assert.equal(r.stop_reason,'INVALID_DRIFT');assert.equal(r.PINCH_IN_EFFECTIVE,false);assert.equal(p.calls.length,1);
 const q=port(s=>s);q.pinch=async()=>{throw Error('command failed');};const a=await calibrateAnchors(q);assert.equal(a.stop_reason,'COMMAND_ERROR');assert.equal(a.attempts[0].success,false);
 const before=snap(),after=snap();after.identity='changed';assert.throws(()=>anchorMetrics(before,after,'in'));
});
test('SVG annotation uses literal computed coordinates and refuses screenshot/viewport mismatch',()=>{
 const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(1080,16);png.writeUInt32BE(2400,20);
 const s=snap(),plan=anchorPlan(s,REFERENCE_ANCHORS,'in'),svg=annotatedAnchorScreenshot(png,s,plan,{width:1080,height:2400});assert.ok(svg.includes('cx="749" cy="978"'));assert.ok(svg.includes('cx="270" cy="1014"'));assert.ok(svg.includes('not Instagram controls'));assert.ok(svg.includes('data:image/png;base64,'));assert.throws(()=>annotatedAnchorScreenshot(png,s,plan,{width:1080,height:1920}));assert.throws(()=>annotatedAnchorScreenshot(Buffer.from('bad'),s,plan,{width:1080,height:2400}));
});
test('invalid proportional anchors never generate a touch plan',()=>{assert.throws(()=>anchorPlan(snap(),{red:{x:1,y:.2},green:{x:.1,y:.8}},'in'));assert.throws(()=>anchorPlan(snap(),{red:{x:.5,y:.5},green:{x:.5,y:.5}},'in'));});
