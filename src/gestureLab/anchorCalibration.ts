import {center,validateSnapshot,width,type Snapshot,type Point} from './core.js';
export type AnchorPercent={red:{x:number;y:number};green:{x:number;y:number}};
export type AnchorDirection='in'|'out';
export type AnchorPlan={direction:AnchorDirection;percent:AnchorPercent;red:Point;green:Point;midpoint:Point;finger1_start:Point;finger1_end:Point;finger2_start:Point;finger2_end:Point;contraction:number};
export const REFERENCE_ANCHORS:AnchorPercent={red:{x:.95,y:.29},green:{x:.04,y:.70}};
/** One parameter at a time, not a 3^4 Cartesian search. */
export function anchorGrid():AnchorPercent[]{
 const variants:[ 'red'|'green','x'|'y',number][]=[['red','x',.93],['red','x',.97],['red','y',.27],['red','y',.31],['green','x',.02],['green','x',.06],['green','y',.68],['green','y',.72]];
 return [structuredClone(REFERENCE_ANCHORS),...variants.map(([which,axis,value])=>{const p=structuredClone(REFERENCE_ANCHORS);p[which][axis]=value;return p;})];
}
export function anchorPlan(s:Snapshot,percent:AnchorPercent,direction:AnchorDirection):AnchorPlan {
 validateSnapshot(s);
 if(!['in','out'].includes(direction))throw Error('Direção inválida.');
 for(const p of [percent.red,percent.green])if(![p.x,p.y].every(v=>Number.isFinite(v)&&v>0&&v<1))throw Error('Âncora proporcional inválida.');
 const b=s.bounds,h=b.bottom-b.top,at=(p:Point)=>({x:Math.round(b.left+width(b)*p.x),y:Math.round(b.top+h*p.y)});
 const red=at(percent.red),green=at(percent.green),midpoint={x:(red.x+green.x)/2,y:(red.y+green.y)/2},contraction=.35;
 const inner=(p:Point)=>({x:Math.round(midpoint.x+(p.x-midpoint.x)*(1-contraction)),y:Math.round(midpoint.y+(p.y-midpoint.y)*(1-contraction))});
 const plan={direction,percent:structuredClone(percent),red,green,midpoint,contraction,finger1_start:direction==='in'?red:inner(red),finger1_end:direction==='in'?inner(red):red,finger2_start:direction==='in'?green:inner(green),finger2_end:direction==='in'?inner(green):green};
 for(const p of [plan.finger1_start,plan.finger1_end,plan.finger2_start,plan.finger2_end])if(p.x<=b.left||p.x>=b.right||p.y<=b.top||p.y>=b.bottom)throw Error('Âncora fora da área segura.');
 if(Math.hypot(red.x-green.x,red.y-green.y)<20)throw Error('Separação insuficiente.');
 return plan;
}
export function anchorActions(p:AnchorPlan){
 const pointer=(id:string,start:Point,end:Point)=>({type:'pointer' as const,id,parameters:{pointerType:'touch' as const},actions:[
  {type:'pointerMove' as const,origin:'viewport' as const,duration:0,...start},{type:'pointerDown' as const,button:0},{type:'pause' as const,duration:150},
  ...Array.from({length:5},(_,i)=>({type:'pointerMove' as const,origin:'viewport' as const,duration:150,x:Math.round(start.x+(end.x-start.x)*(i+1)/5),y:Math.round(start.y+(end.y-start.y)*(i+1)/5)})),{type:'pointerUp' as const,button:0}]});
 return [pointer('anchor-red',p.finger1_start,p.finger1_end),pointer('anchor-green',p.finger2_start,p.finger2_end)];
}
export function sameAnchorObject(a:Snapshot,b:Snapshot){validateSnapshot(b);if(a.identity!==b.identity||a.device!==b.device||JSON.stringify(a.canvas)!==JSON.stringify(b.canvas))throw Error('Objeto/canvas/dispositivo mudou.');}
export function anchorMetrics(before:Snapshot,after:Snapshot,direction:AnchorDirection,initial=before){
 sameAnchorObject(before,after);sameAnchorObject(initial,after);
 const delta=width(after.bounds)-width(before.bounds),drift=Math.hypot(center(after.bounds).x-center(before.bounds).x,center(after.bounds).y-center(before.bounds).y),cumulative=Math.hypot(center(after.bounds).x-center(initial.bounds).x,center(after.bounds).y-center(initial.bounds).y),driftTolerance=Math.max(5,width(initial.canvas)*.02);
 const valid=drift<=driftTolerance&&cumulative<=driftTolerance;
 return {before_width:width(before.bounds),after_width:width(after.bounds),delta_width:delta,center_drift:drift,cumulative_center_drift:cumulative,drift_tolerance:driftTolerance,valid,effect:Math.abs(delta)>=3,directional_effect:direction==='in'?delta<=-3:delta>=3,no_effect:Math.abs(delta)<3};
}
export interface AnchorPort{
 read():Promise<Snapshot>;capture(name:string):Promise<void>;
 mark(name:string,before:Snapshot,plan:AnchorPlan):Promise<string>;
 pinch(plan:AnchorPlan,before:Snapshot):Promise<void>;
 record(value:Record<string,unknown>):Promise<void>;
}
export async function calibrateAnchors(port:AnchorPort){
 const initial=await port.read();validateSnapshot(initial);
 const attempts=[];let preferredIn:AnchorPercent|null=null,preferredOut:AnchorPercent|null=null,stop_reason='CALIBRATION_COMPLETED',aborted=false;
 for(const direction of ['in','out'] as const){
  const grid=anchorGrid();
  if(direction==='out'&&preferredIn){const key=JSON.stringify(preferredIn);grid.sort((a,b)=>Number(JSON.stringify(b)===key)-Number(JSON.stringify(a)===key));}
  const phaseStart=await port.read();sameAnchorObject(initial,phaseStart);
  for(let i=0;i<grid.length;i++){
   const before=await port.read();sameAnchorObject(initial,before);
   const plan=anchorPlan(before,grid[i]!,direction),name=`anchor-${direction}-${i+1}`;
   await port.capture(`${name}-before`);
   const screenshot=await port.mark(`${name}-before`,before,plan);
   const command={direction,attempt:i+1,sticker_bounds:before.bounds,red_anchor_percent:plan.percent.red,red_anchor_px:plan.red,green_anchor_percent:plan.percent.green,green_anchor_px:plan.green,diagonal_midpoint:plan.midpoint,finger1_start:plan.finger1_start,finger1_end:plan.finger1_end,finger2_start:plan.finger2_start,finger2_end:plan.finger2_end,initial_distance_between_fingers:Math.hypot(plan.finger1_start.x-plan.finger2_start.x,plan.finger1_start.y-plan.finger2_start.y),final_distance_between_fingers:Math.hypot(plan.finger1_end.x-plan.finger2_end.x,plan.finger1_end.y-plan.finger2_end.y),screenshot};
   await port.record({phase:'COMMAND',...command});
   let command_error:string|null=null;
   try{await port.pinch(plan,before);}catch(e){command_error=String(e);}
   const after=await port.read();sameAnchorObject(initial,after);await port.capture(`${name}-after`);
   const metrics=anchorMetrics(before,after,direction,phaseStart),entry={...command,before,after,...metrics,command_error,success:!command_error&&metrics.valid&&metrics.directional_effect};
   attempts.push(entry);await port.record(entry);
   if(command_error||!metrics.valid){stop_reason=command_error?'COMMAND_ERROR':'INVALID_DRIFT';aborted=true;break;}
   if(entry.success){if(direction==='in')preferredIn=plan.percent;else preferredOut=plan.percent;break;}
   if(metrics.effect){stop_reason='WRONG_DIRECTION';aborted=true;break;}
  }
  if(aborted)break;
 }
 return {kind:'anchor-calibration',method:'W3C_DIAGONAL',initial,attempts,PINCH_IN_EFFECTIVE:attempts.some(a=>a.direction==='in'&&a.success),PINCH_OUT_EFFECTIVE:attempts.some(a=>a.direction==='out'&&a.success),preferred_in_anchors:preferredIn,preferred_out_anchors:preferredOut,
  preferred_anchors:preferredIn&&JSON.stringify(preferredIn)===JSON.stringify(preferredOut)?preferredIn:null,
  selection_policy:'FIRST_MEASURABLE_EFFECT_WITH_VALID_DRIFT_PER_DIRECTION',lowest_width_reached:Math.min(width(initial.bounds),...attempts.filter(a=>a.valid&&!a.command_error).map(a=>a.after_width)),stop_reason,published:false};
}
