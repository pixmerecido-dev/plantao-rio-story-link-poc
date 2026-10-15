import {center,validateSnapshot,width,type Snapshot,type Point} from './core.js';
export type Geometry='A'|'B'|'C';
export type PinchPlan={method:'W3C_EXPLICIT';geometry:Geometry;strength:number;finger1_start:Point;finger2_start:Point;finger1_end:Point;finger2_end:Point};
export function minimumPinchPlan(s:Snapshot,geometry:Geometry,strength:number):PinchPlan {
  validateSnapshot(s);
  if(!['A','B','C'].includes(geometry)||!Number.isFinite(strength)||strength<=0||strength>=1) throw Error('Geometria/intensidade inválida.');
  const c=center(s.bounds),offset=width(s.bounds)*({A:0.15,B:0.35,C:0.45}[geometry]);
  const point=(x:number)=>({x:Math.round(x),y:Math.round(c.y)});
  const plan={method:'W3C_EXPLICIT' as const,geometry,strength,
    finger1_start:point(c.x-offset),finger2_start:point(c.x+offset),
    finger1_end:point(c.x-offset*(1-strength)),finger2_end:point(c.x+offset*(1-strength))};
  for(const p of [plan.finger1_start,plan.finger2_start,plan.finger1_end,plan.finger2_end])
    if(p.x<=s.bounds.left||p.x>=s.bounds.right||p.y<=s.bounds.top||p.y>=s.bounds.bottom) throw Error('Pointer fora do sticker.');
  if(plan.finger1_start.x>=plan.finger1_end.x||plan.finger2_start.x<=plan.finger2_end.x||plan.finger1_end.x>=plan.finger2_end.x) throw Error('Pinch sem deslocamento seguro.');
  return plan;
}
export function minimumPinchActions(plan:PinchPlan) {
  const pointer=(id:string,start:Point,end:Point)=>({type:'pointer' as const,id,parameters:{pointerType:'touch' as const},actions:[
    {type:'pointerMove' as const,origin:'viewport' as const,duration:0,...start},
    {type:'pointerDown' as const,button:0},
    {type:'pause' as const,duration:150},
    ...Array.from({length:5},(_,i)=>({type:'pointerMove' as const,origin:'viewport' as const,duration:150,x:Math.round(start.x+(end.x-start.x)*(i+1)/5),y:Math.round(start.y+(end.y-start.y)*(i+1)/5)})),
    {type:'pointerUp' as const,button:0},
  ]});
  return [pointer('min-size-finger-1',plan.finger1_start,plan.finger1_end),pointer('min-size-finger-2',plan.finger2_start,plan.finger2_end)];
}
function sameObject(before:Snapshot,after:Snapshot) {
  validateSnapshot(before);validateSnapshot(after);
  if(before.identity!==after.identity||before.device!==after.device||JSON.stringify(before.canvas)!==JSON.stringify(after.canvas)) throw Error('Objeto/dispositivo/canvas mudou.');
}
export interface MinimumPort {
  read():Promise<Snapshot>;
  capture(name:string):Promise<void>;
  pinch(plan:PinchPlan,before:Snapshot):Promise<void>;
  record(value:Record<string,unknown>):Promise<void>;
}
export async function investigateMinimum(port:MinimumPort) {
  const initial=await port.read();validateSnapshot(initial);
  await port.capture('min-size-initial');
  const attempts=[];let consecutive=0,observedMin=width(initial.bounds),last=initial;
  let stopReason='ATTEMPT_LIMIT';
  // Three geometries per cycle; a finite limit also covers continued reductions without a stall.
  for(let i=0;i<12;i++) {
    const before=await port.read();sameObject(initial,before);
    const geometry=(['A','B','C'] as const)[i%3]!;
    const strength=[0.25,0.35,0.45,0.50][Math.floor(i/3)]!;
    const plan=minimumPinchPlan(before,geometry,strength);
    await port.capture(`min-size-${i+1}-before`);
    await port.record({attempt:i+1,phase:'COMMAND',before_width:width(before.bounds),...plan});
    let command_error:string|null=null;
    try{await port.pinch(plan,before);}catch(error){command_error=String(error);}
    const after=await port.read();sameObject(initial,after);last=after;
    await port.capture(`min-size-${i+1}-after`);
    const delta=width(after.bounds)-width(before.bounds),noEffect=Math.abs(delta)<3;
    observedMin=Math.min(observedMin,width(before.bounds),width(after.bounds));
    const entry={attempt:i+1,gesture_geometry:geometry,...plan,before,after,before_width:width(before.bounds),after_width:width(after.bounds),delta_px:delta,no_effect:noEffect,command_error};
    attempts.push(entry);await port.record(entry);
    if(command_error){stopReason='COMMAND_ERROR';break;}
    if(delta>=3){stopReason='UNEXPECTED_INCREASE';break;}
    consecutive=noEffect?consecutive+1:0;
    if(consecutive===3){stopReason='THREE_CONSECUTIVE_NO_EFFECT';break;}
  }
  const belowReference=observedMin<501;
  const stalled=stopReason==='THREE_CONSECUTIVE_NO_EFFECT';
  return {kind:'min-size',method:'W3C_EXPLICIT',initial,initial_width:width(initial.bounds),attempts,observed_min_width:observedMin,last,stop_reason:stopReason,
    reference_width:504,reference_crossed:belowReference,
    MIN_SIZE_LIMIT_OBSERVED:stalled&&!belowReference&&Math.abs(observedMin-504)<=12,
    GESTURE_GEOMETRY_LIMIT:belowReference,
    conclusion:belowReference?'AUTOMATION_REDUCED_BELOW_REFERENCE':'INCONCLUSIVE_WITHOUT_MANUAL_CONTROL',
    physical_limit_proven:false,published:false};
}
export function manualMinimumResult(before:Snapshot,after:Snapshot) {
  sameObject(before,after);
  const delta=width(after.bounds)-width(before.bounds);
  return {kind:'min-size-manual',before,after,initial_width:width(before.bounds),final_width:width(after.bounds),observed_min_width:Math.min(width(before.bounds),width(after.bounds)),delta_px:delta,
    measurable_reduction:delta<=-3,below_reference:width(after.bounds)<501,
    conclusion:delta<=-3&&width(after.bounds)<501?'MANUAL_REDUCED_BELOW_REFERENCE_AUTOMATION_LIMIT_SUSPECTED':'INCONCLUSIVE_MANUAL_ATTEMPT',
    physical_limit_proven:false,published:false};
}
