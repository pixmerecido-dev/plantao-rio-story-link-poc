import test from 'node:test';
import assert from 'node:assert/strict';
import {center,safeTarget,movementMetrics,benchmarkMove,benchmarkResize,resizeTrial,RESIZE_TOLERANCE,measuredPinchSupport} from '../dist/gestureLab/core.js';
function fixture({working='W3C',fraction=1,resize=true}={}) {
  let box={left:300,top:700,right:700,bottom:780};
  const calls=[],captures=[];
  const port={
    read:async()=>({bounds:structuredClone(box),canvas:{left:0,top:0,right:1080,bottom:1920},identity:'user-provided-sticker',device:'mock'}),
    capture:async name=>captures.push(name),
    move:async(method,from,to)=>{ calls.push(method);if(method===working) {const dx=(to.x-from.x)*fraction,dy=(to.y-from.y)*fraction;box={left:box.left+dx,top:box.top+dy,right:box.right+dx,bottom:box.bottom+dy};}},
    resize:async(method,b,factor)=>{calls.push(method);if(resize){const c=center(b),w=(b.right-b.left)*factor,h=(b.bottom-b.top)*factor;box={left:c.x-w/2,top:c.y-h/2,right:c.x+w/2,bottom:c.y+h/2};}},
  };return {port,calls,captures};
}
test('command returning without displacement never passes',async()=>{
 const f=fixture({working:'none'}),r=await benchmarkMove(f.port);
 assert.equal(r.qualified,false);assert.equal(r.recommended,null);
 assert.deepEqual(f.calls,['W3C','ADB-700','ADB-1000','ADB-1300','NATIVE']);
 assert.equal(r.attempts.length,5);assert.equal(r.rounds.length,0);
});
test('candidate requires five measured repeatable rounds, with artifacts',async()=>{
 const f=fixture(),r=await benchmarkMove(f.port);
 assert.equal(r.qualified,true);assert.equal(r.passed,5);assert.equal(r.recommended,'W3C');
 assert.equal(f.calls.length,6);assert.equal(f.captures.length,12);
 assert.equal(r.comparison.find(m=>m.method==='NATIVE').status,'NOT_TESTED');
});
test('ADB parameters tested only after W3C fails',async()=>{
 const f=fixture({working:'ADB-1000'}),r=await benchmarkMove(f.port);
 assert.equal(r.recommended,'ADB-1000');assert.deepEqual(f.calls.slice(0,3),['W3C','ADB-700','ADB-1000']);
});
test('successful discovery with failed repetition is never recommended',async()=>{
 const f=fixture();const move=f.port.move;let count=0;
 f.port.move=async(...args)=>{if(++count===1)await move(...args);};
 const r=await benchmarkMove(f.port);assert.equal(r.qualified,false);assert.equal(r.recommended,null);assert.equal(r.rounds.length,1);
});
test('small motion, wrong direction and lateral drift cannot satisfy 70 percent',async()=>{
 const before=await fixture().port.read();
 for(const [dx,dy] of [[-30,40],[150,-200],[-150,400]]) {
  const after=structuredClone(before);after.bounds.left+=dx;after.bounds.right+=dx;after.bounds.top+=dy;after.bounds.bottom+=dy;
  assert.equal(movementMetrics(before,after,{x:350,y:940}).success,false);
 }
});
test('clamp reduces requested displacement to physically possible target',async()=>{
 const s=await fixture().port.read();s.bounds={left:0,top:700,right:696,bottom:816};
 const target=safeTarget(s,{x:100,y:958});assert.equal(target.x,348);
 const after=structuredClone(s);after.bounds.top+=200;after.bounds.bottom+=200;
 assert.equal(movementMetrics(s,after,target).success,true);
});
test('changed object invalidates measurements',async()=>{
 const s=await fixture().port.read();assert.throws(()=>movementMetrics(s,{...s,identity:'other'},{x:350,y:940}),/mudou/);
});
test('native resize converges with bounded incremental factors and five measured trials',async()=>{
 const f=fixture(),r=await benchmarkResize(f.port,'NATIVE');
 assert.equal(r.qualified,true);assert.equal(r.passed,5);assert.ok(r.mean_absolute_error<=0.03);
 for(const trial of r.rounds)for(const i of trial.iterations)assert.ok(i.strength>=0.1&&i.strength<=0.4);
});
test('ineffective pinch preserves correction slot and stops without success',async()=>{
 const f=fixture({resize:false}),r=await resizeTrial(f.port,0.8,'NATIVE','mock');
 assert.equal(r.success,false);assert.ok(r.iterations.length<=4);assert.equal(r.actual_scale,1);
});
test('pinch drifting center cannot pass width-only validation',async()=>{
 const f=fixture();const resize=f.port.resize;
 f.port.resize=async(...args)=>{await resize(...args);const current=await f.port.read();const c=center(current.bounds);await f.port.move('W3C',c,{x:c.x+50,y:c.y});};
 const r=await resizeTrial(f.port,0.9,'NATIVE','mock');assert.equal(r.success,false);assert.ok(r.center_drift>=50);
});

test('observed native reduction 672 to 636 avoids ineffective tiny remaining-factor correction',async()=>{
 const f=fixture(); let box={left:204,top:700,right:876,bottom:816};
 f.port.read=async()=>({bounds:structuredClone(box),canvas:{left:0,top:0,right:1080,bottom:1920},identity:'sticker',device:'mock'});
 const strengths=[];
 f.port.resize=async(_method,_bounds,factor,strength)=>{
  strengths.push(strength);
  if(strength<0.10)return;
  const c=center(box),w=box.right-box.left;
  const change=w*(36/672)*(strength/0.10);
  const next=w+(factor<1?-change:change);
  box={left:c.x-next/2,top:700,right:c.x+next/2,bottom:816};
 };
 const r=await resizeTrial(f.port,0.9,'NATIVE','observed');
 assert.equal(r.success,true);assert.ok(Math.abs(r.error)<=0.03);
 assert.ok(strengths.every(s=>s>=0.10));
 assert.equal(r.iterations[0].after_width,636);
 assert.equal(r.iterations.length,2);
});
test('no effect immediately increases physical strength rather than repeating tiny correction',async()=>{
 const f=fixture(); const resize=f.port.resize;
 f.port.resize=async(method,bounds,factor,strength)=>{if(strength>=0.125)await resize(method,bounds,factor);};
 const r=await resizeTrial(f.port,0.9,'NATIVE','threshold');
 assert.equal(r.iterations[0].no_effect,true);
 assert.equal(r.iterations[0].strength,0.1);
 assert.equal(r.iterations[1].strength,0.125);
 assert.equal(r.success,true);
 assert.equal(r.minimum_observed_effective_strength.in,0.125);
 assert.equal(r.last_no_effect_strength.in,0.1);
});

test('adaptive pinch reverses direction after overshoot and measures pinch out',async()=>{
 const f=fixture();const resize=f.port.resize;let first=true;
 f.port.resize=async(method,bounds,factor,strength)=>{
   if(first){first=false;await resize(method,bounds,0.75);}
   else await resize(method,bounds,factor);
 };
 const r=await resizeTrial(f.port,0.9,'NATIVE','overshoot');
 assert.equal(r.success,true);
 assert.equal(r.iterations[0].direction,'in');
 assert.ok(r.iterations.some(i=>i.direction==='out'));
 assert.ok(Math.abs(r.error_percent)<=RESIZE_TOLERANCE*100);
 assert.ok(r.iterations.length<=5);
});

test('overshoot on attempt four reserves attempt five for inverse correction',async()=>{
 const f=fixture(); const resize=f.port.resize; let n=0;
 f.port.resize=async(method,bounds,factor,strength)=>{
   n++;
   if(n===4) await resize(method,bounds,0.85);
   else if(n===5) await resize(method,bounds,360/(bounds.right-bounds.left));
 };
 const r=await resizeTrial(f.port,0.9,'NATIVE','reserved');
 assert.equal(r.iterations.length,5);
 assert.equal(r.iterations[3].overshoot,true);
 assert.equal(r.iterations[4].direction,'out');
 assert.equal(r.success,true);
 assert.equal(r.PINCH_OUT_SUPPORTED,true);
});
test('resize qualification requires measured pinch-out, no width change blocks rounds',async()=>{
 const f=fixture({resize:false});const r=await benchmarkResize(f.port,'NATIVE');
 assert.equal(r.PINCH_OUT_SUPPORTED,false);assert.equal(r.rounds.length,0);
 assert.equal(r.qualified,false);assert.equal(r.mean_absolute_error,null);
});
test('absolute target remains anchored to initial width and no gesture follows tolerance',async()=>{
 const f=fixture();const r=await resizeTrial(f.port,0.9,'NATIVE','absolute');
 assert.equal(r.target_width,360);assert.equal(r.iterations.length,1);
 assert.equal(r.stop_reason,'WITHIN_TOLERANCE');
 assert.ok(Math.abs(r.iterations[0].error_after_percent)<=3);
 assert.equal(r.iterations[0].error_before_percent,(400-360)/360*100);
});

test('real 542 to 504 reduction passes four percent and stops without extra pinch',async()=>{
 const f=fixture();let box={left:269,top:700,right:811,bottom:790};let gestures=0;
 f.port.read=async()=>({bounds:structuredClone(box),canvas:{left:0,top:0,right:1080,bottom:1920},identity:'sticker',device:'mock'});
 f.port.resize=async()=>{gestures++;box={left:288,top:700,right:792,bottom:790};};
 const r=await resizeTrial(f.port,0.9,'NATIVE','real-edge');
 assert.equal(RESIZE_TOLERANCE,0.04);assert.equal(r.target_width,487.8);
 assert.equal(r.final_width,504);assert.equal(r.success,true);
 assert.equal(r.PINCH_IN_SUPPORTED,true);assert.equal(gestures,1);
 assert.equal(r.stop_reason,'WITHIN_TOLERANCE');
 assert.ok(r.error_percent>3&&r.error_percent<4);
});
test('support is measured per direction regardless of previously reported flags',async()=>{
 const before=await fixture().port.read();
 const reduce={...before,bounds:{...before.bounds,right:before.bounds.right-38}};
 const grow={...before,bounds:{...before.bounds,right:before.bounds.right+38}};
 assert.deepEqual(measuredPinchSupport([
  {direction:'in',before,after:reduce,command_error:null,PINCH_IN_SUPPORTED:false},
  {direction:'out',before,after:grow,command_error:null,PINCH_OUT_SUPPORTED:false},
 ]),{PINCH_IN_SUPPORTED:true,PINCH_OUT_SUPPORTED:true});
 assert.deepEqual(measuredPinchSupport([
  {direction:'in',before,after:before,command_error:null},
  {direction:'out',before,after:grow,command_error:'failed'},
 ]),{PINCH_IN_SUPPORTED:false,PINCH_OUT_SUPPORTED:false});
});
test('resize above four percent is not approved by new operational tolerance',async()=>{
 const f=fixture();let box={left:269,top:700,right:811,bottom:790};
 f.port.read=async()=>({bounds:structuredClone(box),canvas:{left:0,top:0,right:1080,bottom:1920},identity:'sticker',device:'mock'});
 f.port.resize=async()=>{box={left:285.5,top:700,right:794.5,bottom:790};};
 const r=await resizeTrial(f.port,0.9,'NATIVE','outside');
 assert.ok(r.error_percent>4);assert.equal(r.success,false);
});

test('aggregate retains pinch-in proven during probe correction even when next round has no effect',async()=>{
 const f=fixture();const resize=f.port.resize;let n=0;
 f.port.resize=async(method,bounds,factor)=>{
   n++;
   if(n===1)await resize(method,bounds,1.2);
   else if(n===2)await resize(method,bounds,0.9);
 };
 const r=await benchmarkResize(f.port,'NATIVE');
 assert.equal(r.pinch_out_probe.PINCH_IN_SUPPORTED,true);
 assert.equal(r.rounds[0].PINCH_IN_SUPPORTED,false);
 assert.equal(r.PINCH_IN_SUPPORTED,true);
 assert.equal(r.PINCH_OUT_SUPPORTED,true);
 assert.equal(r.qualified,false);
});
