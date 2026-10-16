import {center,width,validateSnapshot,RESIZE_TOLERANCE,type Snapshot} from './core.js';
import type {MinimumPort,PinchPlan,Geometry} from './minSize.js';
export const AMPLITUDES=[12,28,44] as const; // physical travel in px per finger, not native percentages
function same(a:Snapshot,b:Snapshot){validateSnapshot(b);if(a.identity!==b.identity||a.device!==b.device||JSON.stringify(a.canvas)!==JSON.stringify(b.canvas))throw Error('Objeto/dispositivo/canvas mudou.');}
export function nearMinGeometryPlan(s:Snapshot,geometry:Geometry,travel:number):PinchPlan {
 validateSnapshot(s);
 if(!['A','B','C'].includes(geometry)||!AMPLITUDES.includes(travel as 12|28|44))throw Error('Geometria/amplitude inválida.');
 const c=center(s.bounds),offset=Math.floor(width(s.bounds)*({A:.15,B:.35,C:.45}[geometry]));
 const left=Math.round(c.x-offset),right=Math.round(c.x+offset),y=Math.round(c.y);
 const plan:PinchPlan={method:'W3C_EXPLICIT',geometry,strength:travel/offset,finger1_start:{x:left,y},finger2_start:{x:right,y},finger1_end:{x:left+travel,y},finger2_end:{x:right-travel,y}};
 for(const p of [plan.finger1_start,plan.finger2_start,plan.finger1_end,plan.finger2_end])if(p.x<=s.bounds.left+2||p.x>=s.bounds.right-2||p.y<=s.bounds.top+2||p.y>=s.bounds.bottom-2)throw Error('Pointer fora da área segura.');
 if(plan.finger1_end.x>=plan.finger2_end.x)throw Error('Pointers cruzados.');
 return plan;
}
function coordinates(p:PinchPlan){return {
 finger1_start_x:p.finger1_start.x,finger1_start_y:p.finger1_start.y,finger1_end_x:p.finger1_end.x,finger1_end_y:p.finger1_end.y,
 finger2_start_x:p.finger2_start.x,finger2_start_y:p.finger2_start.y,finger2_end_x:p.finger2_end.x,finger2_end_y:p.finger2_end.y,
 initial_distance_between_fingers:Math.hypot(p.finger2_start.x-p.finger1_start.x,p.finger2_start.y-p.finger1_start.y),
 final_distance_between_fingers:Math.hypot(p.finger2_end.x-p.finger1_end.x,p.finger2_end.y-p.finger1_end.y)};}
async function attempt(port:MinimumPort,initial:Snapshot,geometry:Geometry,travel:number,index:number,target:number){
 const before=await port.read();same(initial,before);
 const plan=nearMinGeometryPlan(before,geometry,travel);
 await port.capture(`geometry-${index}-before`);
 await port.record({phase:'COMMAND',attempt:index,geometry,travel_px_per_finger:travel,...coordinates(plan)});
 let command_error:string|null=null;
 try{await port.pinch(plan,before);}catch(e){command_error=String(e);}
 const after=await port.read();same(initial,after);await port.capture(`geometry-${index}-after`);
 const delta=width(after.bounds)-width(before.bounds),drift=Math.hypot(center(after.bounds).x-center(before.bounds).x,center(after.bounds).y-center(before.bounds).y);
 const cumulativeDrift=Math.hypot(center(after.bounds).x-center(initial.bounds).x,center(after.bounds).y-center(initial.bounds).y);
 const driftTolerance=Math.max(5,width(initial.canvas)*.02),valid=!command_error&&drift<=driftTolerance&&cumulativeDrift<=driftTolerance;
 const entry={geometry,attempt:index,travel_px_per_finger:travel,...coordinates(plan),plan,before,after,before_width:width(before.bounds),after_width:width(after.bounds),delta_px:delta,center_drift:drift,cumulative_center_drift:cumulativeDrift,drift_tolerance:driftTolerance,valid,command_error,no_effect:Math.abs(delta)<3,effect:Math.abs(delta)>=3,EFFECT:Math.abs(delta)>=3,PINCH_IN_EFFECTIVE:valid&&delta<=-3,target_width:target,error_percent:(width(after.bounds)-target)/target*100,success:valid&&Math.abs(width(after.bounds)-target)/target<=RESIZE_TOLERANCE};
 await port.record(entry);return entry;
}
export async function investigateNearMinGeometry(port:MinimumPort,target:number){
 const initial=await port.read();validateSnapshot(initial);
 if(!Number.isFinite(target)||target<=0||width(initial.bounds)<520||width(initial.bounds)>535)throw Error('Exige largura inicial entre 520 e 535 px e alvo conhecido.');
 const attempts=[];let preferred:null|{geometry:Geometry;travel_px_per_finger:number}=null,stop_reason='NINE_ATTEMPTS_COMPLETED';
 for(let i=0;i<9;i++){
  const r=await attempt(port,initial,(['A','B','C'] as const)[i%3]!,AMPLITUDES[Math.floor(i/3)]!,i+1,target);attempts.push(r);
  if(!r.valid){stop_reason=r.command_error?'COMMAND_ERROR':'INVALID_DRIFT';break;}
  if(r.PINCH_IN_EFFECTIVE){preferred={geometry:r.geometry,travel_px_per_finger:r.travel_px_per_finger};stop_reason='EFFECTIVE_GEOMETRY_FOUND';break;}
  if(r.delta_px>=3){stop_reason='UNEXPECTED_INCREASE';break;}
 }
 return {kind:'near-min-geometry',method:'W3C_EXPLICIT',initial,target_width:target,tolerance:RESIZE_TOLERANCE,attempts,preferred_geometry:preferred,preferred_near_min_geometry:preferred,near_min_effective:preferred!==null,lowest_width_reached:Math.min(width(initial.bounds),...attempts.filter(r=>r.valid).map(r=>r.after_width)),reached_524_or_less:attempts.some(r=>r.valid&&r.after_width<=524),NEAR_MIN_AUTOMATED_PINCH_LIMIT:attempts.length===9&&attempts.every(r=>r.valid&&!r.effect),stop_reason,published:false};
}
export async function convergePreferredGeometry(port:MinimumPort,target:number,proof:any){
 const initial=await port.read();validateSnapshot(initial);
 const p=proof?.preferred_geometry;
 const evidence=proof?.attempts?.find((r:any)=>r.PINCH_IN_EFFECTIVE&&r.valid&&!r.command_error&&r.delta_px<=-3&&r.geometry===p?.geometry&&r.travel_px_per_finger===p?.travel_px_per_finger);
 if(proof?.kind!=='near-min-geometry'||proof.near_min_effective!==true||proof.target_width!==target||!evidence||!['A','B','C'].includes(p?.geometry)||!AMPLITUDES.includes(p?.travel_px_per_finger))throw Error('Exige relatório de geometria com redução comprovada.');
 same(initial,proof.initial);
 if(width(initial.bounds)<520||width(initial.bounds)>535)throw Error('Reposicione apenas o tamanho manualmente entre 520 e 535 px antes da convergência.');
 const attempts=[];
 for(let i=0;i<3;i++){
  const current=await port.read();same(initial,current);
  if(Math.abs(width(current.bounds)-target)/target<=RESIZE_TOLERANCE)break;
  const r=await attempt(port,initial,p.geometry,p.travel_px_per_finger,i+1,target);attempts.push(r);
  if(!r.valid||r.no_effect||r.delta_px>=3||r.success)break; // never repeat an ignored identical geometry
 }
 const last=await port.read();same(initial,last);
 return {kind:'near-min-geometry-converge',initial,last,target_width:target,tolerance:RESIZE_TOLERANCE,preferred_geometry:p,attempts,final_width:width(last.bounds),success:attempts.every(r=>r.valid)&&Math.abs(width(last.bounds)-target)/target<=RESIZE_TOLERANCE,published:false};
}
