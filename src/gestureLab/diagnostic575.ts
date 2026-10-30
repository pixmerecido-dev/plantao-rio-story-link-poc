import {emulatorMirrorPlan,emulatorMirrorActions,type ViewportRect,type MirrorPlan} from './emulatorMirrorPinch.js';
import {validateSynchronizedTouchActions} from './shortTouchExecution.js';
import {anchorMetrics,sameAnchorObject} from './anchorCalibration.js';
import {center,width,validateSnapshot,type Snapshot,type Point,type Box} from './core.js';
import {diagnosticTouchTimeline} from './diagnosticTouchTimeline.js';
export const DIAGNOSTIC_575_VARIANTS=[
 {id:'B',anchor:{x:.88,y:.35},factor:1/1.2,step_ms:60,steps:10,change:'CONTACTS_MORE_INTERNAL'},
 {id:'C',anchor:{x:.98,y:.22},factor:1/1.2,step_ms:60,steps:10,change:'CONTACTS_MORE_EXTERNAL'},
 {id:'D',anchor:{x:.95,y:.29},factor:.90,step_ms:60,steps:10,change:'SAME_INITIAL_DISTANCE_SHORTER_PATH'},
 {id:'E',anchor:{x:.95,y:.29},factor:1/1.2,step_ms:120,steps:10,change:'SAME_PATH_LONGER_DURATION'},
] as const;
export type Diagnostic575Variant=typeof DIAGNOSTIC_575_VARIANTS[number];
const inside=(p:Point,b:Box,margin=0)=>p.x>b.left+margin&&p.x<b.right-margin&&p.y>b.top+margin&&p.y<b.bottom-margin;
export function geometry575(snapshot:Snapshot,viewport:ViewportRect,variant:Diagnostic575Variant){
 if(!DIAGNOSTIC_575_VARIANTS.some(v=>JSON.stringify(v)===JSON.stringify(variant)))throw Error('Variante não prevista.');
 const base=emulatorMirrorPlan(snapshot,viewport,'in');
 const first={x:Math.round(snapshot.bounds.left+width(snapshot.bounds)*variant.anchor.x),y:Math.round(snapshot.bounds.top+(snapshot.bounds.bottom-snapshot.bounds.top)*variant.anchor.y)};
 const mirror=(p:Point)=>({x:Math.round(2*base.center.x-p.x),y:Math.round(2*base.center.y-p.y)});
 const end={x:Math.round(base.center.x+(first.x-base.center.x)*variant.factor),y:Math.round(base.center.y+(first.y-base.center.y)*variant.factor)};
 const plan:MirrorPlan={...base,inside_anchor_percent:{...variant.anchor},growth_factor:variant.factor,distance_factor:variant.factor,finger1_start:first,finger1_end:end,finger2_start:mirror(first),finger2_end:mirror(end)};
 const screen={left:viewport.x,top:viewport.y,right:viewport.x+viewport.width,bottom:viewport.y+viewport.height};
 for(const p of [first,end,plan.finger2_start,plan.finger2_end])if(!inside(p,screen,16)||!inside(p,snapshot.canvas,2))throw Error('Trajetória fora da área segura; nenhum gesto enviado.');
 if(!inside(first,snapshot.bounds)||inside(plan.finger2_start,snapshot.bounds))throw Error('Contatos não correspondem ao modelo espelhado.');
 const angle=(a:Point,b:Point)=>Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
 plan.planned_angle_delta_degrees=((angle(end,plan.finger2_end)-angle(first,plan.finger2_start)+540)%360)-180;
 if(Math.abs(plan.planned_angle_delta_degrees)>1)throw Error('Rotação planejada excessiva.');
 const actions=emulatorMirrorActions(plan).map(source=>({...source,actions:source.actions.map((a,i)=>i>=2&&a.type==='pointerMove'?{...a,duration:variant.step_ms}:a)}));
 validateSynchronizedTouchActions(actions);
 return {variant,plan,actions,geometry:describe575(snapshot,plan,actions)};
}
export function describe575(snapshot:Snapshot,plan:MirrorPlan,actions:ReturnType<typeof emulatorMirrorActions>){
 const paths=actions.map((s,index)=>{
  const points=s.actions.filter((a):a is Extract<typeof a,{type:'pointerMove'}>=>a.type==='pointerMove').map(a=>({x:a.x,y:a.y}));
  const flags=points.map(p=>inside(p,snapshot.bounds));
  return {pointer:s.id,start:points[0],end:points.at(-1),path:points,starts_inside_xml_bounds:flags[0],ends_inside_xml_bounds:flags.at(-1),any_point_outside_xml_bounds:flags.some(f=>!f),crosses_xml_boundary:flags.some(f=>f!==flags[0]),
   actual_interactive_hit_region:'UNKNOWN_XML_RECTANGLE_IS_NOT_APP_HIT_TEST',role:index===0?'INSIDE_CONTACT':'EXTERNAL_MIRRORED_CONTACT'};
 });
 let elapsed=0;
 const requested_event_timeline=actions[0]!.actions.map((a,tick)=>{const begin=elapsed;elapsed+=a.type==='pointerMove'?a.duration:0;return {tick,start_offset_ms:begin,end_offset_ms:elapsed,contacts:actions.map(s=>({pointer:s.id,...s.actions[tick]}))};});
 const moves=actions[0]!.actions.filter(a=>a.type==='pointerMove').slice(1);
 return {bounds:{...snapshot.bounds},width:width(snapshot.bounds),height:snapshot.bounds.bottom-snapshot.bounds.top,center:center(snapshot.bounds),anchors:plan.inside_anchor_percent,distance_factor:plan.distance_factor,
  finger1_start:plan.finger1_start,finger1_end:plan.finger1_end,finger2_start:plan.finger2_start,finger2_end:plan.finger2_end,
  initial_distance_between_fingers:Math.hypot(plan.finger1_start.x-plan.finger2_start.x,plan.finger1_start.y-plan.finger2_start.y),
  final_distance_between_fingers:Math.hypot(plan.finger1_end.x-plan.finger2_end.x,plan.finger1_end.y-plan.finger2_end.y),
  requested_event_timeline,duration_ms:moves.reduce((sum,a)=>sum+a.duration,0),steps:moves.length,step_durations_ms:moves.map(a=>a.duration),paths};
}
export interface Diagnostic575Port{
 read():Promise<Snapshot>;
 attempt(geometry:ReturnType<typeof geometry575>,before:Snapshot):Promise<{after:Snapshot;command_error:string|null;logcat:string;log_truncated:boolean;artifacts:Record<string,unknown>;visual:Record<string,unknown>}>;
}
export async function runDiagnostic575(port:Diagnostic575Port,viewport:ViewportRect,progress:(report:ReturnType<typeof diagnostic575Report>)=>Promise<void>=async()=>{}){
 const initial=await port.read();validateSnapshot(initial);
 if(width(initial.bounds)!==575)throw Error(`Diagnóstico exige 575 px; medido ${width(initial.bounds)}. Nenhum gesto enviado.`);
 const attempts:Diagnostic575Attempt[]=[];let expected=initial,stop_reason='ALL_VARIANTS_NO_MEASURABLE_REDUCTION';
 await progress(diagnostic575Report(initial,attempts,'READY'));
 for(const variant of DIAGNOSTIC_575_VARIANTS){
  const before=await port.read();sameAnchorObject(initial,before);
  if(JSON.stringify(before)!==JSON.stringify(expected))throw Error('Estado mudou fora do diagnóstico; nenhum novo gesto.');
  if(width(before.bounds)!==575){stop_reason='STATE_NO_LONGER_575';break;}
  const geometry=geometry575(before,viewport,variant),result=await port.attempt(geometry,before);
  sameAnchorObject(initial,result.after);const metrics=anchorMetrics(before,result.after,'in',initial),timeline=diagnosticTouchTimeline(result.logcat);
  const valid=!result.command_error&&!result.log_truncated&&timeline.sequence_valid&&metrics.valid;
  const success=valid&&metrics.delta_width<=-3;
  const attempt={variant:variant.id,change:variant.change,before,after:result.after,...metrics,geometry:geometry.geometry,plan:geometry.plan,actions:geometry.actions,
   command_error:result.command_error,touch_timeline:{...timeline,truncated:result.log_truncated},artifacts:result.artifacts,visual:result.visual,
   EFFECT:Math.abs(metrics.delta_width)>=3,PINCH_IN_EFFECTIVE:success,success};
  attempts.push(attempt);expected=result.after;
  if(!valid)stop_reason='INVALID_DRIFT_COMMAND_OR_INJECTION';
  else if(success)stop_reason='MEASURABLE_REDUCTION_FOUND';
  else if(metrics.delta_width>=3)stop_reason='WRONG_DIRECTION';
  else if(result.visual.visual_change_without_xml_change_candidate===true)stop_reason='VISUAL_CHANGE_REQUIRES_REVIEW';
  else if(JSON.stringify(before.bounds)!==JSON.stringify(result.after.bounds))stop_reason='BOUNDS_CHANGED_REQUIRES_REVIEW';
  await progress(diagnostic575Report(initial,attempts,stop_reason));
  if(stop_reason!=='ALL_VARIANTS_NO_MEASURABLE_REDUCTION')break;
 }
 return diagnostic575Report(initial,attempts,stop_reason);
}
type Diagnostic575Attempt={variant:string;change:string;before:Snapshot;after:Snapshot;success:boolean;EFFECT:boolean;PINCH_IN_EFFECTIVE:boolean;delta_width:number;geometry:ReturnType<typeof describe575>;plan:MirrorPlan;actions:ReturnType<typeof emulatorMirrorActions>;command_error:string|null;touch_timeline:ReturnType<typeof diagnosticTouchTimeline>&{truncated:boolean};artifacts:Record<string,unknown>;visual:Record<string,unknown>};
export function diagnostic575Report(initial:Snapshot,attempts:Diagnostic575Attempt[],stop_reason:string){
 const winner=attempts.find(a=>a.success);
 return {kind:'gesture-575-diagnostic',initial,attempts:[...attempts],variants:[{variant:'A',status:'REUSED_HISTORICAL_BASELINE_NO_NEW_GESTURE'},...DIAGNOSTIC_575_VARIANTS.map(v=>({variant:v.id,status:attempts.some(a=>a.variant===v.id)?'EXECUTED_ONCE':'NOT_EXECUTED'}))],
  lowest_width_reached:Math.min(width(initial.bounds),...attempts.map(a=>width(a.after.bounds))),preferred_variant:winner?.variant??null,pinch_in_effective:!!winner,stop_reason,
  probable_cause:winner?winner.variant==='E'?'TIMING_SENSITIVITY':winner.variant==='D'?'PATH_AMPLITUDE_SENSITIVITY':'CONTACT_PLACEMENT_SENSITIVITY':stop_reason==='ALL_VARIANTS_NO_MEASURABLE_REDUCTION'?'APP_LEVEL_REJECTION_OR_CURRENT_SIZE_FLOOR_UNRESOLVED':'INSUFFICIENT_EVIDENCE',
  cause_proven:false,minimum_updated:false,controller_updated:false,benchmark_executed:false,panel_integration:false,published:false};
}
