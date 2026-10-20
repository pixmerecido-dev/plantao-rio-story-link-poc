import {anchorMetrics,sameAnchorObject} from './anchorCalibration.js';
import {RESIZE_TOLERANCE,validateSnapshot,width,type Snapshot} from './core.js';
import type {MirrorCycleRun,VerifiedMirrorTrial} from './emulatorMirrorCycles.js';
import type {ObservedStickerLimit} from '../admin/stickerSizeLimit.js';
import {sessionPrecisionLimit,type SessionMinimumObservation} from './sessionMinimum.js';
export type MirrorPrecisionText='Veja'|'Leia a matéria completa'|'veja a materia complata no jornal';
export const MIRROR_FINAL_TARGETS=[.9,.8,1.1,.9,1.1] as const;
export const MIRROR_PRECISION_TARGETS=[1.1,.9,1.1,.9,1.1] as const;
export async function mirrorPrecisionTrial(read:()=>Promise<Snapshot>,run:MirrorCycleRun,scale:1.1|.9|.8,round:number,limit?:ObservedStickerLimit,text:MirrorPrecisionText='Veja',finalBattery=false){
 if(!(finalBattery?[1.1,.9,.8]:[1.1,.9]).includes(scale))throw Error('Este ensaio permite apenas alvos de ±10%.');
 const before=await read();validateSnapshot(before);
 const known=limit?.scope.text===text&&limit.scope.style_index===0&&limit.scope.device===before.device&&limit.scope.canvas_width===width(before.canvas)&&limit.scope.canvas_height===before.canvas.bottom-before.canvas.top?limit:undefined;
 const requested=width(before.bounds)*scale,target=Math.max(requested,known?.observed_min_width??0),clamped=requested<target;
 const iterations:VerifiedMirrorTrial[]=[];let after=before,stop_reason='ATTEMPT_LIMIT',valid=true;
 for(let i=0;i<3;i++){
  const fresh=await read();sameAnchorObject(before,fresh);
  if(JSON.stringify(fresh)!==JSON.stringify(after))throw Error('Estado mudou fora do controlador; nenhum novo gesto.');
  const errorBefore=(width(fresh.bounds)-target)/target;
  if(Math.abs(errorBefore)<=RESIZE_TOLERANCE){stop_reason='WITHIN_TOLERANCE';break;}
  const direction=errorBefore>0?'in':'out',trial=await run(direction,round*10+i+1,fresh);
  sameAnchorObject(before,trial.before);sameAnchorObject(before,trial.after);
  if(JSON.stringify(trial.before)!==JSON.stringify(fresh))throw Error('Estado inicial do gesto divergiu.');
  iterations.push(trial);after=trial.after;
  const errorAfter=(width(after.bounds)-target)/target;
  if(trial.command_error){valid=false;stop_reason='COMMAND_ERROR';break;}
  if(!trial.touch_injection.injection_sequence_observed||trial.touch_injection.truncated){valid=false;stop_reason='INJECTION_NOT_CONFIRMED';break;}
  if(!trial.valid||!anchorMetrics(before,after,direction).valid){valid=false;stop_reason='INVALID_DRIFT';break;}
  if(Math.abs(trial.delta_width)<3){valid=false;stop_reason='NO_EFFECT';break;}
  if(trial.direction!==direction||!trial.success||!trial.measured_resize_success||(direction==='out'?trial.delta_width<=0:trial.delta_width>=0)){valid=false;stop_reason='WRONG_DIRECTION_OR_INVALID_EFFECT';break;}
  if(Math.abs(errorAfter)<=RESIZE_TOLERANCE){stop_reason='WITHIN_TOLERANCE';break;}
  if(errorBefore*errorAfter<0){stop_reason='OVERSHOOT_OUTSIDE_TOLERANCE';break;}
 }
 const error=(width(after.bounds)-target)/target;
 return {round,requested_scale:scale,before,after,initial_width:width(before.bounds),requested_target_width:requested,effective_target_width:target,observed_min_width:known?.observed_min_width??null,clamped,clamp_reason:clamped?'INSTAGRAM_MIN_SIZE':null,tolerance:RESIZE_TOLERANCE,final_width:width(after.bounds),error,error_percent:error*100,iterations,gesture_skipped:iterations.length===0,stop_reason,success:valid&&Math.abs(error)<=RESIZE_TOLERANCE,published:false};
}
type PrecisionRound=Awaited<ReturnType<typeof mirrorPrecisionTrial>>;
function report(rounds:PrecisionRound[],text:MirrorPrecisionText='Veja',finalBattery=false){
 const passed=rounds.filter(r=>r.success).length;
 return {kind:finalBattery?'final-emulator-mirror-benchmark':text==='Veja'?'short-emulator-mirror-precision':'text-emulator-mirror-precision',text_declared_by_operator:text,method:'W3C_EMULATOR_MIRROR',targets:finalBattery?MIRROR_FINAL_TARGETS:MIRROR_PRECISION_TARGETS,tolerance:RESIZE_TOLERANCE,rounds:[...rounds],passed,total:5,qualified:rounds.length===5&&passed===5,
  clamped_count:rounds.filter(r=>r.clamped).length,mean_absolute_error_percent:rounds.length?rounds.reduce((s,r)=>s+Math.abs(r.error_percent),0)/rounds.length:null,
  qualification_scope:finalBattery?'CURRENT_STANDARD_TEXT_FINAL_SEQUENCE':text==='Veja'?'CURRENT_VEJA_PROFILE_ONLY_PLUS_MINUS_TEN_PERCENT_TARGETS':'CURRENT_DECLARED_TEXT_PROFILE_ONLY_PLUS_MINUS_TEN_PERCENT_TARGETS',panel_integration:false,published:false};
}
export async function benchmarkMirrorPrecision(read:()=>Promise<Snapshot>,run:MirrorCycleRun,limit?:ObservedStickerLimit,progress:(result:ReturnType<typeof report>)=>Promise<void>=async()=>{},text:MirrorPrecisionText='Veja',finalBattery=false,sessionObservation?:SessionMinimumObservation){
 if(sessionObservation){
  if(!finalBattery)throw Error('Observação de sessão exige bateria final isolada.');
  limit=sessionPrecisionLimit(sessionObservation,await read(),text);
 }
 if(finalBattery&&(text!=='Leia a matéria completa'||limit?.scope.text!==text||(limit.observed_min_width!==504&&!sessionObservation)))throw Error('Bateria final exige texto padrão e mínimo confirmado de 504 px para esta configuração.');
 const rounds:PrecisionRound[]=[];let expected:Snapshot|undefined;
 for(const [index,scale] of (finalBattery?MIRROR_FINAL_TARGETS:MIRROR_PRECISION_TARGETS).entries()){
  if(expected&&JSON.stringify(await read())!==JSON.stringify(expected))throw Error('Estado mudou entre rodadas.');
  const result=await mirrorPrecisionTrial(read,run,scale,index+1,limit,text,finalBattery);rounds.push(result);expected=result.after;
  await progress(report(rounds,text,finalBattery));if(!result.success)break;
 }
 return report(rounds,text,finalBattery);
}
