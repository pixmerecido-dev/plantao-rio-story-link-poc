import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {geometry575,DIAGNOSTIC_575_VARIANTS,runDiagnostic575} from '../dist/gestureLab/diagnostic575.js';
import {emulatorMirrorPlan,emulatorMirrorActions} from '../dist/gestureLab/emulatorMirrorPinch.js';
import {loadDiagnostic575History} from '../dist/gestureLab/diagnostic575History.js';
import {diagnosticTouchTimeline} from '../dist/gestureLab/diagnosticTouchTimeline.js';
import {diagnosticImageDiff} from '../dist/gestureLab/diagnosticImageDiff.js';
import {deflateSync} from 'node:zlib';
const viewport={x:0,y:0,width:1080,height:2400};
const snapshot=(w=575)=>({bounds:{left:540-w/2,top:918,right:540+w/2,bottom:1002},canvas:{left:0,top:0,right:1080,bottom:1920},identity:'one',device:'emulator-5554'});
const goodLog=[['ACTION_DOWN',1],['ACTION_POINTER_DOWN(1)',2],['ACTION_MOVE',2],['ACTION_POINTER_UP(1)',2],['ACTION_UP',1]].map(([action,count],i)=>`10-30 00:00:00.00${i} I/appium: [${100+i*10} (success)] Synthesized: MotionEvent { action=${action}, pointerCount=${count}, id[0]=0, x[0]=798, y[0]=942, id[1]=1, x[1]=282, y[1]=1458, eventTime=${100+i*10}, downTime=100 }`).join('\n');
test('only four new variants, no old convergence factors; B/C placement, D shorter, E slower',()=>{
 const s=snapshot(),baseline=emulatorMirrorPlan(s,viewport,'in');
 const plans=DIAGNOSTIC_575_VARIANTS.map(v=>geometry575(s,viewport,v));
 assert.deepEqual(plans.map(p=>p.variant.id),['B','C','D','E']);
 for(const p of plans){assert.ok(![1/1.25,1/1.3,1/1.35].includes(p.plan.distance_factor));assert.ok(Math.abs(p.plan.planned_angle_delta_degrees)<=1);assert.equal(p.geometry.paths[0].starts_inside_xml_bounds,true);assert.equal(p.geometry.paths[1].starts_inside_xml_bounds,false);assert.equal(p.geometry.steps,10);}
 assert.notDeepEqual(plans[0].plan.finger1_start,baseline.finger1_start);assert.notDeepEqual(plans[1].plan.finger1_start,baseline.finger1_start);
 assert.deepEqual(plans[2].plan.finger1_start,baseline.finger1_start);assert.ok(plans[2].geometry.final_distance_between_fingers>plans[3].geometry.final_distance_between_fingers);
 assert.deepEqual(plans[3].plan,baseline);assert.equal(plans[3].geometry.duration_ms,1200);assert.equal(plans[2].geometry.duration_ms,600);
 assert.equal(plans[3].geometry.requested_event_timeline.at(-1).end_offset_ms,1200);
});
function port(changes,options={}){let current=snapshot();const sent=[];return {sent,read:async()=>structuredClone(current),attempt:async g=>{sent.push(g.variant.id);const delta=changes[sent.length-1]??0;current=snapshot(575+delta);return {after:structuredClone(current),command_error:null,logcat:options.log??goodLog,log_truncated:options.truncated??false,artifacts:{},visual:options.visual??{}};}};}
test('one gesture per variant and first effective reduction stops further attempts',async()=>{
 const p=port([0,-8]),r=await runDiagnostic575(p,viewport);assert.deepEqual(p.sent,['B','C']);assert.equal(r.lowest_width_reached,567);assert.equal(r.preferred_variant,'C');assert.equal(r.probable_cause,'CONTACT_PLACEMENT_SENSITIVITY');assert.equal(r.cause_proven,false);assert.equal(r.minimum_updated,false);assert.equal(r.benchmark_executed,false);assert.equal(r.published,false);
 assert.equal(r.variants[0].status,'REUSED_HISTORICAL_BASELINE_NO_NEW_GESTURE');
});
test('four failures stop without invented minimum; invalid injection, visual change and drift stop early',async()=>{
 const p=port([0,0,0,0]),r=await runDiagnostic575(p,viewport);assert.deepEqual(p.sent,['B','C','D','E']);assert.equal(r.preferred_variant,null);assert.equal(r.probable_cause,'APP_LEVEL_REJECTION_OR_CURRENT_SIZE_FLOOR_UNRESOLVED');
 for(const options of [{log:''},{truncated:true},{visual:{visual_change_without_xml_change_candidate:true}}]){const q=port([0],options),s=await runDiagnostic575(q,viewport);assert.equal(q.sent.length,1);assert.equal(s.pinch_in_effective,false);}
 const q=port([-8],{log:''}),s=await runDiagnostic575(q,viewport);assert.equal(s.pinch_in_effective,false);assert.equal(s.stop_reason,'INVALID_DRIFT_COMMAND_OR_INJECTION');
});
test('wrong initial size and an externally changed state never send a gesture',async()=>{
 let sends=0;await assert.rejects(runDiagnostic575({read:async()=>snapshot(574),attempt:async()=>{sends++;throw Error();}},viewport),/575/);assert.equal(sends,0);
 let reads=0;await assert.rejects(runDiagnostic575({read:async()=>{const s=snapshot();if(++reads>1)s.bounds.top++;return s;},attempt:async()=>{sends++;throw Error();}},viewport),/Estado mudou/);assert.equal(sends,0);
});
test('timeline distinguishes ordered two-contact injection from duplicated DOWN or reversed timestamps',()=>{
 const r=diagnosticTouchTimeline(goodLog);assert.equal(r.sequence_valid,true);assert.equal(r.pointer_coordinates_observed,true);assert.equal(r.actual_duration_ms,40);assert.equal(r.events[1].action,'ACTION_POINTER_DOWN');assert.equal(r.events[1].pointers[1].x,282);assert.equal(r.contacts_received_by_instagram,'NOT_OBSERVED');
 assert.equal(diagnosticTouchTimeline(goodLog.replace('ACTION_POINTER_DOWN(1)','ACTION_DOWN')).sequence_valid,false);
 assert.equal(diagnosticTouchTimeline(goodLog.replaceAll('id[1]=1','id[1]=0')).sequence_valid,false);
 assert.equal(diagnosticTouchTimeline(goodLog.replace('eventTime=120','eventTime=90')).sequence_valid,false);
 assert.equal(diagnosticTouchTimeline(goodLog.replace('ACTION_POINTER_UP(1)','ACTION_MOVE')).sequence_valid,false);
 assert.equal(diagnosticTouchTimeline(goodLog.replace('eventTime=130, downTime=100','eventTime=130, downTime=130')).sequence_valid,false);
});
function png(pixels,width=4,height=4,filter=0){
 const channels=3,stride=width*channels,raw=Buffer.alloc((stride+1)*height);
 for(let y=0;y<height;y++){raw[y*(stride+1)]=filter;for(let x=0;x<stride;x++){
  const left=x>=channels?pixels[y*stride+x-channels]:0,up=y?pixels[(y-1)*stride+x]:0,ul=y&&x>=channels?pixels[(y-1)*stride+x-channels]:0,p=left+up-ul,pa=Math.abs(p-left),pb=Math.abs(p-up),pc=Math.abs(p-ul);
  const predicted=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):pa<=pb&&pa<=pc?left:pb<=pc?up:ul;
  raw[y*(stride+1)+1+x]=(pixels[y*stride+x]-predicted)&255;
 }}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
 const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);return b;};
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
test('PNG diff decodes all standard filters; changed encoding is not mistaken for visual change',()=>{
 const pixels=Buffer.from(Array.from({length:48},(_,i)=>(i*37)%256)),base=png(pixels),roi={left:0,top:0,right:4,bottom:4};
 for(let filter=0;filter<=4;filter++)assert.equal(diagnosticImageDiff(base,png(pixels,4,4,filter),roi).changed_pixels,0);
 const changed=Buffer.from(pixels);changed[0]=(changed[0]+30)%256;assert.equal(diagnosticImageDiff(base,png(changed),roi).changed_pixels,1);
 assert.equal(diagnosticImageDiff(base,png(changed),{left:1,top:1,right:4,bottom:4}).changed_pixels,0);
 assert.throws(()=>diagnosticImageDiff(Buffer.from('bad'),base,roi),/PNG/);
});
test('comparison reads actual standard precision and stall reports, not summaries for another text',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gesture-575-'));
 const trial=(before,after,success)=>{const plan=emulatorMirrorPlan(before,viewport,'in');return {direction:'in',before,after,plan,actions:emulatorMirrorActions(plan),command_error:null,valid:true,success,context:{text_declared_by_operator:'Leia a matéria completa',style_index:0},touch_injection:{injection_sequence_observed:true,truncated:false}};};
 try{
  for(const [suffix,filename,t] of [['precision-1','text-emulator-precision-report.json',trial(snapshot(793),snapshot(695),true)],['final-2','final-emulator-resize-report.json',trial(snapshot(),snapshot(),false)]]){
   const dir=join(root,'gesture-text-emulator-pinch-'+suffix);await mkdir(dir);await writeFile(join(dir,filename),JSON.stringify({kind:suffix.startsWith('precision')?'text-emulator-mirror-precision':'final-emulator-mirror-benchmark',qualified:suffix.startsWith('precision'),text_declared_by_operator:'Leia a matéria completa',rounds:[{iterations:[t]}]}));
  }
  const r=await loadDiagnostic575History(root);assert.equal(r.approved.before_width,793);assert.equal(r.approved.after_width,695);assert.equal(r.stalled.before_width,575);assert.equal(r.stalled.after_width,575);assert.equal(r.stalled.timeline,null);assert.equal(r.stalled.timeline_status,'RAW_LOG_UNAVAILABLE_SUMMARY_ONLY');
 }finally{await rm(root,{recursive:true,force:true});}
});
