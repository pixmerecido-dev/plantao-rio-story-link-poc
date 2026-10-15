import test from 'node:test';
import assert from 'node:assert/strict';
import {center,safeTarget,movementMetrics,benchmarkMove,benchmarkResize,resizeTrial} from '../dist/gestureLab/core.js';
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
test('ineffective pinch stops after five iterations without success',async()=>{
 const f=fixture({resize:false}),r=await resizeTrial(f.port,0.8,'NATIVE','mock');
 assert.equal(r.success,false);assert.equal(r.iterations.length,5);assert.equal(r.actual_scale,1);
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
 f.port.resize=async(method,bounds,factor,strength)=>{if(strength>=0.2)await resize(method,bounds,factor);};
 const r=await resizeTrial(f.port,0.8,'NATIVE','threshold');
 assert.equal(r.iterations[0].no_effect,true);
 assert.equal(r.iterations[0].strength,0.1);
 assert.equal(r.iterations[1].strength,0.2);
 assert.equal(r.success,true);
 assert.equal(r.minimum_observed_effective_strength.in,0.2);
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
 assert.ok(Math.abs(r.error_percent)<=3);
 assert.ok(r.iterations.length<=5);
});
