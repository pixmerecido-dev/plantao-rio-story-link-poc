import test from 'node:test';
import assert from 'node:assert/strict';
import {FROZEN_RESIZE_ANCHORS,validateAnchorText,validateAnchorTexts,anchorTextReport,validateCaseText} from '../dist/gestureLab/anchorTextValidation.js';
const texts={short:'Veja',standard:'Leia a matéria completa',long:'Veja todos os detalhes desta matéria no nosso site'};
function fixture(initial=575,adjust=(w,d)=>w+(d==='in'?-38:52)){
 let w=initial,x=540;const calls=[],records=[];
 return {calls,records,read:async()=>({bounds:{left:x-w/2,right:x+w/2,top:900,bottom:1000},canvas:{left:0,top:0,right:1080,bottom:1920},identity:'fixture',device:'emulator-5554'}),capture:async()=>{},mark:async name=>`${name}.svg`,record:async r=>records.push(r),pinch:async plan=>{calls.push(plan);const r=adjust(w,plan.direction);if(typeof r==='object'){w=r.w;x+=r.drift??0;}else w=r;}};
}
test('frozen validated anchors cannot drift to a new grid',()=>{assert.deepEqual(FROZEN_RESIZE_ANCHORS,{red:{x:.95,y:.29},green:{x:.04,y:.70}});assert.throws(()=>{FROZEN_RESIZE_ANCHORS.red.x=.93;});});
test('one in and one out use updated measured bounds and fixed fractions',async()=>{
 const p=fixture(),r=await validateAnchorText(p,'standard',texts.standard,0);
 assert.equal(r.success,true);assert.equal(p.calls.length,2);assert.deepEqual(p.calls.map(x=>x.direction),['in','out']);
 assert.equal(r.pinch_in.before_width,575);assert.equal(r.pinch_in.after_width,537);assert.equal(r.pinch_out.before_width,537);assert.equal(r.pinch_out.after_width,589);
 for(const a of r.attempts){assert.deepEqual(a.red_anchor_percent,{x:.95,y:.29});assert.deepEqual(a.green_anchor_percent,{x:.04,y:.70});assert.equal(a.red_anchor_px.x,Math.round(a.sticker_bounds.left+a.before_width*.95));assert.equal(a.center_drift,0);}
 assert.notEqual(r.pinch_in.red_anchor_px.x,r.pinch_out.red_anchor_px.x);assert.equal(p.records.filter(x=>x.phase==='COMMAND').length,2);
});
test('three actual case measurements needed for qualification; mocks are not live evidence',async()=>{
 const ports={short:fixture(300),standard:fixture(575),long:fixture(900)},progress=[];
 const r=await validateAnchorTexts(async id=>({text:texts[id],style_index:0,port:ports[id]}),async r=>progress.push(r));
 assert.equal(r.ANCHOR_GEOMETRY_QUALIFIED,true);assert.equal(r.passed,3);assert.equal(r.total,3);assert.equal(r.complete,true);assert.equal(r.search_performed,false);assert.equal(r.benchmark_executed,false);assert.equal(r.published,false);
 assert.deepEqual(progress.map(r=>r.ANCHOR_GEOMETRY_QUALIFIED),[false,false,true]);assert.equal(new Set(r.cases.map(c=>c.initial_width)).size,3);
 for(const id of Object.keys(ports))assert.equal(ports[id].calls.length,2);
 assert.equal(anchorTextReport(r.cases.slice(0,2)).ANCHOR_GEOMETRY_QUALIFIED,false);
 assert.equal(anchorTextReport([r.cases[0],r.cases[0],r.cases[2]]).ANCHOR_GEOMETRY_QUALIFIED,false);
});
test('failed direction never causes retries or recalibration; remaining texts can still be measured',async()=>{
 const bad=fixture(575,w=>w),ports={short:fixture(300),standard:bad,long:fixture(900)};
 const r=await validateAnchorTexts(async id=>({text:texts[id],style_index:0,port:ports[id]}));
 assert.equal(r.complete,true);assert.equal(r.ANCHOR_GEOMETRY_QUALIFIED,false);assert.equal(r.passed,2);assert.equal(bad.calls.length,2);assert.equal(r.cases[1].pinch_in.no_effect,true);
});
test('command error and drift invalidate case and stop further gestures',async()=>{
 const p=fixture();p.pinch=async()=>{throw Error('driver error');};const r=await validateAnchorText(p,'short',texts.short,0);assert.equal(r.success,false);assert.equal(r.attempts.length,1);assert.equal(r.pinch_out,null);assert.equal(r.stop_reason,'COMMAND_ERROR');
 const q=fixture(575,(w)=>({w:w-38,drift:30})),a=await validateAnchorText(q,'short',texts.short,0);assert.equal(a.success,false);assert.equal(q.calls.length,1);assert.equal(a.stop_reason,'INVALID_DRIFT');
 let prepared=0;const report=await validateAnchorTexts(async id=>{prepared++;return {text:texts[id],style_index:0,port:q};});assert.equal(prepared,1);assert.equal(report.complete,false);
});
test('wrong sign or sub-threshold movement cannot qualify direction',async()=>{
 const p=fixture(575,(w,d)=>w+(d==='in'?20:20)),r=await validateAnchorText(p,'standard',texts.standard,0);assert.equal(r.success,false);assert.equal(r.pinch_in.success,false);assert.equal(r.pinch_out.success,true);assert.equal(p.calls.length,2);
 const q=fixture(575,(w,d)=>w+(d==='in'?-2:2)),a=await validateAnchorText(q,'standard',texts.standard,0);assert.equal(a.success,false);
});
test('context mismatch disqualifies aggregate and invalid labels prevent any gesture',async()=>{
 const a=await validateAnchorText(fixture(300),'short',texts.short,0),b=await validateAnchorText(fixture(),'standard',texts.standard,1),c=await validateAnchorText(fixture(900),'long',texts.long,0);
 assert.equal(anchorTextReport([a,b,c]).ANCHOR_GEOMETRY_QUALIFIED,false);
 assert.throws(()=>validateCaseText('short','Outro'));assert.throws(()=>validateCaseText('standard','Veja'));assert.throws(()=>validateCaseText('long','Curto'));
 const p=fixture();await assert.rejects(validateAnchorText(p,'short','Outro',0));assert.equal(p.calls.length,0);
});
