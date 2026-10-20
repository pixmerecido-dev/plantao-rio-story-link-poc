import {anchorPlan,anchorMetrics,sameAnchorObject,type AnchorPort,type AnchorPlan} from './anchorCalibration.js';
import {FROZEN_RESIZE_ANCHORS} from './anchorTextValidation.js';
import {validateSnapshot} from './core.js';
export const SHORT_TOUCH_RECIPES=[
 {id:'SIMULTANEOUS_CONTINUOUS',first:'both',entry_delay_ms:0,hold_ms:0,step_ms:60,steps:10},
] as const;
export type ShortTouchRecipe=typeof SHORT_TOUCH_RECIPES[number];
type TouchSource={type:string;id:string;parameters?:{pointerType?:string};actions:{type:string;duration?:number;button?:number}[]};
/** UiAutomator2 on the tested Android rejected delayed second DOWN. Reject it before injection. */
export function validateSynchronizedTouchActions(sources:TouchSource[]){
 if(sources.length!==2||new Set(sources.map(s=>s.id)).size!==2||sources.some(s=>s.type!=='pointer'||s.parameters?.pointerType!=='touch'))throw Error('Exige exatamente dois pointers touch distintos.');
 const [a,b]=sources as [TouchSource,TouchSource];
 if(a.actions.length!==b.actions.length)throw Error('Ticks de touch desalinhados.');
 const pressed=[false,false];let downs=0,ups=0;
 for(let i=0;i<a.actions.length;i++){
  const tick=[a.actions[i]!,b.actions[i]!];
  if(tick[0]!.type!==tick[1]!.type||(tick[0]!.duration??0)!==(tick[1]!.duration??0))throw Error('Dois dedos devem entrar/mover/sair nos mesmos ticks.');
  const type=tick[0]!.type;
  if(type==='pointerDown'){if(pressed.some(Boolean)||downs||tick.some(t=>t.button!==0))throw Error('DOWN inconsistente.');pressed.fill(true);downs++;}
  else if(type==='pointerUp'){if(!pressed.every(Boolean)||ups||tick.some(t=>t.button!==0))throw Error('UP inconsistente.');pressed.fill(false);ups++;}
  else if(type==='pointerMove'){if(i!==0&&!pressed.every(Boolean))throw Error('MOVE sem dois contatos ativos.');}
  else throw Error('Tick não permitido neste gesto contínuo.');
 }
 if(downs!==1||ups!==1||pressed.some(Boolean))throw Error('Ciclo DOWN/MOVE/UP incompleto.');
}
export function shortTouchActions(plan:AnchorPlan,recipe:ShortTouchRecipe){
 if(!SHORT_TOUCH_RECIPES.some(r=>JSON.stringify(r)===JSON.stringify(recipe)))throw Error('Receita não autorizada; entradas sequenciais desativadas.');
 const pointer=(color:'red'|'green')=>{
  const start=color==='red'?plan.finger1_start:plan.finger2_start,end=color==='red'?plan.finger1_end:plan.finger2_end;
  return {type:'pointer' as const,id:`short-${color}`,parameters:{pointerType:'touch' as const},actions:[
   {type:'pointerMove' as const,origin:'viewport' as const,duration:0,...start},{type:'pointerDown' as const,button:0},
   ...Array.from({length:recipe.steps},(_,i)=>({type:'pointerMove' as const,origin:'viewport' as const,duration:recipe.step_ms,x:Math.round(start.x+(end.x-start.x)*(i+1)/recipe.steps),y:Math.round(start.y+(end.y-start.y)*(i+1)/recipe.steps)})),
   {type:'pointerUp' as const,button:0}]};
 };
 const sources=[pointer('red'),pointer('green')];validateSynchronizedTouchActions(sources);return sources;
}
export interface ShortExecutionPort extends Omit<AnchorPort,'pinch'>{pinch(plan:AnchorPlan,before:Parameters<AnchorPort['pinch']>[1],recipe:ShortTouchRecipe):Promise<void>;}
export async function investigateShortTouch(port:ShortExecutionPort){
 const initial=await port.read();validateSnapshot(initial);let candidate:ShortTouchRecipe|null=null,stop_reason='SIMULTANEOUS_NO_EFFECT';
 const attempt=async(recipe:ShortTouchRecipe,direction:'in'|'out')=>{
  const before=await port.read();sameAnchorObject(initial,before);
  const plan=anchorPlan(before,FROZEN_RESIZE_ANCHORS,direction),name=`short-${recipe.id}-${direction}`;
  await port.capture(`${name}-before`);const screenshot=await port.mark(`${name}-before`,before,plan),actions=shortTouchActions(plan,recipe);
  await port.record({phase:'COMMAND',recipe,direction,before,plan,actions,screenshot,contact_evidence:'REQUESTED_ACTIONS_NOT_OBSERVED_CONTACTS'});
  let command_error:string|null=null;
  try{await port.pinch(plan,before,recipe);}catch(error){command_error=String(error);}
  const after=await port.read();sameAnchorObject(initial,after);await port.capture(`${name}-after`);
  const metrics=anchorMetrics(before,after,direction,initial),result={recipe,direction,before,after,plan,actions,screenshot,...metrics,command_error,execution_status:command_error?'COMMAND_ERROR':metrics.directional_effect&&metrics.valid?'MEASURED_EFFECT':'NO_EFFECT_OR_INVALID_DRIFT',success:!command_error&&metrics.valid&&metrics.directional_effect};
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
 return {kind:'short-touch-execution',text_declared_by_operator:'Veja',method:'W3C_DIAGONAL',initial,frozen_anchors:FROZEN_RESIZE_ANCHORS,anchor_search_performed:false,sequential_entry_disabled:true,attempts,candidate_out_recipe:candidate,preferred_recipe:both?candidate:null,SHORT_AUTOMATED_SUCCESS:both,qualification:'SINGLE_ISOLATED_TRIAL_NOT_AGGREGATE_QUALIFICATION',contact_evidence:'REQUESTED_ACTIONS_NOT_OBSERVED_CONTACTS',stop_reason,benchmark_executed:false,published:false};
}
