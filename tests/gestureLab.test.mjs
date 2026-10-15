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
 for(const trial of r.rounds)for(const i of trial.iterations)assert.ok(i.factor>=0.9&&i.factor<=1.1);
});
test('ineffective pinch stops after four iterations without success',async()=>{
 const f=fixture({resize:false}),r=await resizeTrial(f.port,0.8,'NATIVE','mock');
 assert.equal(r.success,false);assert.equal(r.iterations.length,4);assert.equal(r.actual_scale,1);
});
test('pinch drifting center cannot pass width-only validation',async()=>{
 const f=fixture();const resize=f.port.resize;
 f.port.resize=async(...args)=>{await resize(...args);const current=await f.port.read();const c=center(current.bounds);await f.port.move('W3C',c,{x:c.x+50,y:c.y});};
 const r=await resizeTrial(f.port,0.9,'NATIVE','mock');assert.equal(r.success,false);assert.ok(r.center_drift>=50);
});
