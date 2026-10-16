import type { ObservedStickerLimit } from '../admin/stickerSizeLimit.js';
export type Box = {left:number;top:number;right:number;bottom:number};
export type Snapshot = {bounds:Box;canvas:Box;identity:string;device:string};
export type MoveMethod = 'W3C'|'ADB-700'|'ADB-1000'|'ADB-1300'|'NATIVE';
export interface LabPort {
  read():Promise<Snapshot>;
  capture(name:string):Promise<void>;
  move(method:MoveMethod,start:Point,target:Point):Promise<void>;
  resize(method:'NATIVE'|'W3C',bounds:Box,factor:number,strength?:number):Promise<void>;
}
export type Point={x:number;y:number};
export const center=(b:Box):Point=>({x:(b.left+b.right)/2,y:(b.top+b.bottom)/2});
export const width=(b:Box)=>b.right-b.left;
export function validateSnapshot(s:Snapshot) {
  for(const b of [s.bounds,s.canvas]) if(!Object.values(b).every(Number.isFinite)||width(b)<=0||b.bottom<=b.top) throw Error('Bounds inválidos.');
  if(!s.identity||!s.device||s.bounds.left<s.canvas.left||s.bounds.right>s.canvas.right||s.bounds.top<s.canvas.top||s.bounds.bottom>s.canvas.bottom) throw Error('Sticker fora do canvas ou identificação ausente.');
}
export function safeTarget(s:Snapshot,p:Point):Point {
  validateSnapshot(s);
  const hw=width(s.bounds)/2,hh=(s.bounds.bottom-s.bounds.top)/2;
  return {x:Math.max(s.canvas.left+hw,Math.min(s.canvas.right-hw,p.x)),y:Math.max(s.canvas.top+hh,Math.min(s.canvas.bottom-hh,p.y))};
}
export function movementMetrics(before:Snapshot,after:Snapshot,target:Point) {
  validateSnapshot(before);validateSnapshot(after);
  if(before.identity!==after.identity||before.device!==after.device||JSON.stringify(before.canvas)!==JSON.stringify(after.canvas)) throw Error('Objeto/canvas/dispositivo mudou; medição inválida.');
  const start=center(before.bounds),end=center(after.bounds);
  const expected={x:target.x-start.x,y:target.y-start.y},actual={x:end.x-start.x,y:end.y-start.y};
  const distance=Math.hypot(expected.x,expected.y),error=Math.hypot(actual.x-expected.x,actual.y-expected.y);
  const progress=distance>0?(actual.x*expected.x+actual.y*expected.y)/(distance*distance):0;
  const sameSize=Math.abs(width(after.bounds)-width(before.bounds))<=2&&Math.abs((after.bounds.bottom-after.bounds.top)-(before.bounds.bottom-before.bounds.top))<=2;
  return {before_center:start,target_center:target,after_center:end,expected_delta:expected,actual_delta:actual,movement_error:error,progress_ratio:progress,success:distance>=50&&Math.hypot(actual.x,actual.y)>=20&&progress>=0.70&&error<=distance*0.30&&sameSize};
}
export async function moveTrial(port:LabPort,method:MoveMethod,target:Point,name:string) {
  const before=await port.read();validateSnapshot(before);
  const safe=safeTarget(before,target);
  if(Math.hypot(safe.x-center(before.bounds).x,safe.y-center(before.bounds).y)<50) throw Error('Espaço insuficiente para deslocamento mensurável; não enviar gesto.');
  await port.capture(`${name}-before`);
  let command_error:string|null=null;
  try{await port.move(method,center(before.bounds),safe);}catch(e){command_error=String(e);}
  const after=await port.read();await port.capture(`${name}-after`);
  return {method,before,after,...movementMetrics(before,after,safe),command_error};
}
export async function benchmarkMove(port:LabPort) {
  const initial=await port.read();validateSnapshot(initial);
  const start=center(initial.bounds),target=safeTarget(initial,{x:start.x-150,y:start.y+200});
  const attempts:Awaited<ReturnType<typeof moveTrial>>[]=[];
  let winner:MoveMethod|null=null;
  for(const method of ['W3C','ADB-700','ADB-1000','ADB-1300','NATIVE'] as MoveMethod[]) {
    const fresh=await port.read(),c=center(fresh.bounds);
    const result=await moveTrial(port,method,{x:c.x-150,y:c.y+200},`discovery-${method}`);
    attempts.push(result);
    if(result.success&&!result.command_error){winner=method;break;}
  }
  const rounds:Awaited<ReturnType<typeof moveTrial>>[]=[];
  if(winner) {
    // Alternate two known targets, restoring the initial position between outward rounds.
    for(let i=0;i<5;i++) {
      const destination=i%2===0?start:target;
      const trial=await moveTrial(port,winner,destination,`repeat-${i+1}-${winner}`);
      rounds.push(trial);
      if(!trial.success||trial.command_error) break;
    }
  }
  const qualified=rounds.length===5&&rounds.every(r=>r.success&&!r.command_error);
  return {kind:'move',comparison: (['W3C','ADB-700','ADB-1000','ADB-1300','NATIVE'] as MoveMethod[]).map(method=>({method,status:attempts.find(r=>r.method===method)?.success ? 'PASS' : attempts.some(r=>r.method===method) ? 'FAIL' : 'NOT_TESTED'})),initial,attempts,rounds,candidate:winner,recommended:qualified?winner:null,qualified,passed:rounds.filter(r=>r.success&&!r.command_error).length,total:5,last:await port.read(),published:false};
}
export const RESIZE_TOLERANCE = 0.04;
type PinchObservation = {direction:'in'|'out';before:Snapshot;after:Snapshot;command_error:string|null};
/** Derive support from measured actions, including corrections in the probe and all rounds. */
export function measuredPinchSupport(observations:PinchObservation[]) {
  return {
    PINCH_IN_SUPPORTED: observations.some(i=>i.direction==='in'&&!i.command_error&&width(i.before.bounds)-width(i.after.bounds)>=3),
    PINCH_OUT_SUPPORTED: observations.some(i=>i.direction==='out'&&!i.command_error&&width(i.after.bounds)-width(i.before.bounds)>=3),
  };
}
/** Error-band controller: observed gain is diagnostic, never a linear actuator model. */
export async function resizeTrial(port:LabPort,scale:number,method:'NATIVE'|'W3C',name:string,limit?:ObservedStickerLimit,nearMinOnly=false) {
  if(![0.9,0.8,1.1].includes(scale)) throw Error('Use escala controlada 0.9, 0.8 ou 1.1.');
  const before=await port.read();validateSnapshot(before);
  const applicableLimit=limit && limit.scope.canvas_width===width(before.canvas) && limit.scope.canvas_height===before.canvas.bottom-before.canvas.top && limit.scope.device===before.device ? limit : undefined;
  if(nearMinOnly&&(!applicableLimit||width(before.bounds)<525||width(before.bounds)>535)) throw Error('NEAR_MIN exige limite conhecido e largura inicial entre 525 e 535 px.');
  const requestedTarget=nearMinOnly?applicableLimit!.observed_min_width:width(before.bounds)*scale;
  const clamped=Boolean(applicableLimit && requestedTarget<applicableLimit.observed_min_width);
  const target=clamped?applicableLimit!.observed_min_width:requestedTarget,iterations=[];
  await port.capture(`${name}-before`);
  let after=before,overshootSeen=false,stopReason='ATTEMPT_LIMIT';
  let previousDirection: 'in'|'out'|undefined;
  let previousStrength=0.10;
  const gains: Partial<Record<'in'|'out',number>> = {};
  const minimumEffective: Partial<Record<'in'|'out',number>> = {};
  const lastIgnored: Partial<Record<'in'|'out',number>> = {};
  let nearMinGestures=0;
  for(let i=0;i<(nearMinOnly?3:5);i++) {
    const fresh=await port.read();validateSnapshot(fresh);
    if(fresh.identity!==before.identity||fresh.device!==before.device||JSON.stringify(fresh.canvas)!==JSON.stringify(before.canvas)) throw Error('Objeto mudou durante resize.');
    const currentWidth=width(fresh.bounds),errorBefore=(currentWidth-target)/target;
    if(Math.abs(errorBefore)<=RESIZE_TOLERANCE){after=fresh;stopReason='WITHIN_TOLERANCE';break;}
    // Preserve one slot for direction reversal; never spend the fifth gesture on blind convergence.
    if(!nearMinOnly&&i===4&&!overshootSeen){stopReason='CORRECTION_SLOT_RESERVED';break;}
    const direction: 'in'|'out'=currentWidth>target?'in':'out';
    const absError=Math.abs(errorBefore);
    const band=absError>0.15?'FAR':absError>0.08?'SMALL':'NEAR';
    const nearMin=Boolean(applicableLimit&&direction==='in'&&currentWidth>applicableLimit.observed_min_width&&(currentWidth-applicableLimit.observed_min_width)/applicableLimit.observed_min_width<=0.08);
    if(nearMin&&nearMinGestures>=3){stopReason='NEAR_MIN_ATTEMPT_LIMIT';break;}
    const cap=nearMin?0.205:band==='FAR'?0.30:band==='SMALL'?0.20:0.15;
    // 0.175 is the previously measured native threshold; it remains a trial, not a success claim.
    const base=nearMin?0.175:band==='FAR'?0.20:0.10;
    let strength=nearMin?base:Math.min(cap,base,minimumEffective[direction]??base);
    if(previousDirection&&previousDirection!==direction) strength=Math.min(strength,Math.max(0.10,previousStrength/2));
    if(lastIgnored[direction]!==undefined) strength=Math.max(strength,lastIgnored[direction]!+(nearMin?0.01:0.025));
    if(strength>cap+1e-9){stopReason='NO_EFFECT_BAND_LIMIT';break;}
    if(nearMin) nearMinGestures++;
    const factor=direction==='in'?1-strength:1+strength;
    let command_error:string|null=null;
    try{await port.resize(method,fresh.bounds,factor,strength);}catch(e){command_error=String(e);}
    after=await port.read();validateSnapshot(after);
    if(after.identity!==before.identity||after.device!==before.device||JSON.stringify(after.canvas)!==JSON.stringify(before.canvas)) throw Error('Objeto mudou durante resize.');
    await port.capture(`${name}-iteration-${i+1}`);
    const deltaPx=width(after.bounds)-currentWidth,noEffect=Math.abs(deltaPx)<3;
    const effectRatio=Math.abs(deltaPx)/currentWidth;
    const correctDirection=direction==='in'?deltaPx<0:deltaPx>0;
    const errorAfter=(width(after.bounds)-target)/target;
    const overshoot=errorBefore*errorAfter<0;
    overshootSeen ||= overshoot;
    iterations.push({attempt:i+1,RESIZE_MODE:nearMin?'NEAR_MIN':'NORMAL',target_width:target,success:!command_error&&Math.abs(errorAfter)<=RESIZE_TOLERANCE,direction,strength,error_band:band,before:fresh,after,factor,command_error,
      before_width:currentWidth,after_width:width(after.bounds),delta_px:deltaPx,effect_ratio:effectRatio,
      error_before_percent:errorBefore*100,error_after_percent:errorAfter*100,
      no_effect:noEffect,overshoot,GESTURE_BELOW_THRESHOLD:noEffect,status:noEffect?'NO_EFFECT':correctDirection?'EFFECT':'WRONG_DIRECTION'});
    previousDirection=direction;previousStrength=strength;
    if(command_error){stopReason='COMMAND_ERROR';break;}
    if(!noEffect&&!correctDirection){stopReason='WRONG_DIRECTION';break;}
    if(noEffect) lastIgnored[direction]=strength;
    else {
      minimumEffective[direction]=Math.min(minimumEffective[direction]??Infinity,strength);
      gains[direction]=effectRatio/strength;
    }
    if(Math.abs(errorAfter)<=RESIZE_TOLERANCE){stopReason='WITHIN_TOLERANCE';break;}
  }
  await port.capture(`${name}-after`);
  const actual_scale=width(after.bounds)/width(before.bounds),error=(width(after.bounds)-target)/target;
  const drift=Math.hypot(center(after.bounds).x-center(before.bounds).x,center(after.bounds).y-center(before.bounds).y);
  const {PINCH_IN_SUPPORTED:pinchIn,PINCH_OUT_SUPPORTED:pinchOut}=measuredPinchSupport(iterations);
  return {kind:nearMinOnly?'near-min':'resize-trial',RESIZE_MODE:nearMinOnly?'NEAR_MIN':'AUTO',method,tolerance:RESIZE_TOLERANCE,requested_scale:scale,
    lower_minimum_candidate:applicableLimit&&width(after.bounds)<applicableLimit.observed_min_width-2?width(after.bounds):null,TARGET_BELOW_MIN:clamped,clamped,reason:clamped?'INSTAGRAM_MIN_SIZE':null,
    requested_target_width:requestedTarget,effective_target_width:target,observed_min_width:applicableLimit?.observed_min_width??null,minimum_limit_scope:applicableLimit?.scope??null,
    requested_error_percent:(width(after.bounds)-requestedTarget)/requestedTarget*100,
    initial_width:width(before.bounds),target_width:target,final_width:width(after.bounds),error_percent:error*100,stop_reason:stopReason,
    PINCH_IN_SUPPORTED:pinchIn,PINCH_OUT_SUPPORTED:pinchOut,
    minimum_observed_effective_strength:minimumEffective,last_no_effect_strength:lastIgnored,observed_gain_per_strength:gains,
    supported:pinchIn||pinchOut,calibrated:false,before,after,before_width:width(before.bounds),before_height:before.bounds.bottom-before.bounds.top,after_width:width(after.bounds),after_height:after.bounds.bottom-after.bounds.top,
    iterations,actual_scale,error,center_drift:drift,success:(clamped||iterations.length>0)&&iterations.every(i=>!i.command_error)&&Math.abs(error)<=RESIZE_TOLERANCE&&(clamped||Math.abs(width(after.bounds)-width(before.bounds))>=2)&&drift<=Math.max(5,width(before.canvas)*0.02)};
}
export async function benchmarkResize(port:LabPort,method:'NATIVE'|'W3C',limit?:ObservedStickerLimit) {
  const pinchOutProbe=await resizeTrial(port,1.1,method,`pinch-out-probe-${method}`,limit);
  const rounds=[];
  if(pinchOutProbe.PINCH_OUT_SUPPORTED) for(let i=0;i<5;i++) {
    const result=await resizeTrial(port,[0.9,0.8,1.1,0.9,1.1][i]!,method,`resize-${method}-${i+1}`,limit);
    rounds.push(result);if(!result.success) break;
  }
  const qualified=rounds.length===5&&rounds.every(r=>r.success);
  return {kind:'resize',clamped_count:rounds.filter(r=>r.clamped).length,method,tolerance:RESIZE_TOLERANCE,pinch_out_probe:pinchOutProbe,
    ...measuredPinchSupport([pinchOutProbe,...rounds].flatMap(r=>r.iterations)),
    supported:pinchOutProbe.supported||rounds.some(r=>r.supported),calibrated:qualified,rounds,qualified,recommended:qualified?method:null,passed:rounds.filter(r=>r.success).length,total:5,
    mean_absolute_error:rounds.length?rounds.reduce((sum,r)=>sum+Math.abs(r.error),0)/rounds.length:null,last:await port.read(),published:false};
}

export async function nearMinTrial(port:LabPort,method:'NATIVE'|'W3C',limit:ObservedStickerLimit) {
  return resizeTrial(port,0.9,method,'near-min',limit,true);
}
export function validateNearMinProof(proof:any,current:Snapshot,method:string,limit:ObservedStickerLimit) {
  if(proof?.kind!=='near-min'||proof.success!==true||proof.method!==method||proof.tolerance!==RESIZE_TOLERANCE||proof.initial_width<525||proof.initial_width>535||proof.target_width!==limit.observed_min_width||Math.abs(proof.final_width-limit.observed_min_width)/limit.observed_min_width>RESIZE_TOLERANCE||!Array.isArray(proof.iterations)||proof.iterations.length<1||proof.iterations.length>3||proof.iterations.some((i:any)=>i.command_error)||proof.before?.identity!==current.identity||proof.before?.device!==current.device||JSON.stringify(proof.before?.canvas)!==JSON.stringify(current.canvas)||JSON.stringify(proof.minimum_limit_scope)!==JSON.stringify(limit.scope)) throw Error('Execute smoke:gesture-near-min com PASS nesta configuração antes do benchmark.');
}
