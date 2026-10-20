import {anchorPlan,anchorMetrics,sameAnchorObject,type AnchorPort,type AnchorPlan} from './anchorCalibration.js';
import {FROZEN_RESIZE_ANCHORS} from './anchorTextValidation.js';
import {validateSnapshot} from './core.js';
export const SHORT_TOUCH_RECIPES=[
 {id:'FAST_SIMULTANEOUS',first:'both',entry_delay_ms:0,hold_ms:30,step_ms:60,steps:5},
 {id:'RED_FIRST',first:'red',entry_delay_ms:80,hold_ms:150,step_ms:150,steps:5},
 {id:'GREEN_FIRST',first:'green',entry_delay_ms:80,hold_ms:150,step_ms:150,steps:5},
] as const;
export type ShortTouchRecipe=typeof SHORT_TOUCH_RECIPES[number];
export function shortTouchActions(plan:AnchorPlan,recipe:ShortTouchRecipe){
 if(!SHORT_TOUCH_RECIPES.some(r=>JSON.stringify(r)===JSON.stringify(recipe)))throw Error('Receita não autorizada para este ensaio.');
 const pointer=(color:'red'|'green')=>{
  const start=color==='red'?plan.finger1_start:plan.finger2_start,end=color==='red'?plan.finger1_end:plan.finger2_end;
  const down={type:'pointerDown' as const,button:0},pause=(duration:number)=>({type:'pause' as const,duration});
  const entry=recipe.first==='both'?[down]:[color===recipe.first?down:pause(0),pause(recipe.entry_delay_ms),color===recipe.first?pause(0):down];
  return {type:'pointer' as const,id:`short-${color}`,parameters:{pointerType:'touch' as const},actions:[
   {type:'pointerMove' as const,origin:'viewport' as const,duration:0,...start},...entry,pause(recipe.hold_ms),
   ...Array.from({length:recipe.steps},(_,i)=>({type:'pointerMove' as const,origin:'viewport' as const,duration:recipe.step_ms,x:Math.round(start.x+(end.x-start.x)*(i+1)/recipe.steps),y:Math.round(start.y+(end.y-start.y)*(i+1)/recipe.steps)})),
   {type:'pointerUp' as const,button:0}]};
 };
 return [pointer('red'),pointer('green')];
}
export interface ShortExecutionPort extends Omit<AnchorPort,'pinch'>{pinch(plan:AnchorPlan,before:Parameters<AnchorPort['pinch']>[1],recipe:ShortTouchRecipe):Promise<void>;}
export async function investigateShortTouch(port:ShortExecutionPort){
 const initial=await port.read();validateSnapshot(initial);let candidate:ShortTouchRecipe|null=null,stop_reason='THREE_RECIPES_NO_EFFECT';
 const attempt=async(recipe:ShortTouchRecipe,direction:'in'|'out')=>{
  const before=await port.read();sameAnchorObject(initial,before);
  const plan=anchorPlan(before,FROZEN_RESIZE_ANCHORS,direction),name=`short-${recipe.id}-${direction}`;
  await port.capture(`${name}-before`);const screenshot=await port.mark(`${name}-before`,before,plan),actions=shortTouchActions(plan,recipe);
  await port.record({phase:'COMMAND',recipe,direction,before,plan,actions,screenshot,contact_evidence:'REQUESTED_ACTIONS_NOT_OBSERVED_CONTACTS'});
  let command_error:string|null=null;
  try{await port.pinch(plan,before,recipe);}catch(error){command_error=String(error);}
  const after=await port.read();sameAnchorObject(initial,after);await port.capture(`${name}-after`);
  const metrics=anchorMetrics(before,after,direction,initial),result={recipe,direction,before,after,plan,actions,screenshot,...metrics,command_error,success:!command_error&&metrics.valid&&metrics.directional_effect};
  await port.record(result);return result;
 };
 const attempts:Awaited<ReturnType<typeof attempt>>[]=[];
 for(const recipe of SHORT_TOUCH_RECIPES){
  const out=await attempt(recipe,'out');attempts.push(out);
  if(out.command_error||!out.valid){stop_reason=out.command_error?'COMMAND_ERROR':'INVALID_DRIFT';break;}
  if(out.success){candidate=recipe;const inward=await attempt(recipe,'in');attempts.push(inward);stop_reason=inward.success?'BOTH_DIRECTIONS_MEASURED':inward.command_error?'COMMAND_ERROR':!inward.valid?'INVALID_DRIFT':'PINCH_IN_NOT_CONFIRMED';break;}
  if(out.effect){stop_reason='WRONG_DIRECTION';break;}
 }
 const both=attempts.some(a=>a.direction==='out'&&a.success)&&attempts.some(a=>a.direction==='in'&&a.success);
 return {kind:'short-touch-execution',text_declared_by_operator:'Veja',method:'W3C_DIAGONAL',initial,frozen_anchors:FROZEN_RESIZE_ANCHORS,anchor_search_performed:false,attempts,candidate_out_recipe:candidate,preferred_recipe:both?candidate:null,SHORT_AUTOMATED_SUCCESS:both,qualification:'SINGLE_ISOLATED_TRIAL_NOT_AGGREGATE_QUALIFICATION',contact_evidence:'REQUESTED_ACTIONS_NOT_OBSERVED_CONTACTS',stop_reason,benchmark_executed:false,published:false};
}
