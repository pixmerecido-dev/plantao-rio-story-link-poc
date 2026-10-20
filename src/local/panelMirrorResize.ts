import {anchorMetrics,sameAnchorObject} from '../gestureLab/anchorCalibration.js';
import {RESIZE_TOLERANCE,width,validateSnapshot,type Snapshot} from '../gestureLab/core.js';
import type {MirrorCycleRun,VerifiedMirrorTrial} from '../gestureLab/emulatorMirrorCycles.js';
/** Test-only controller. Session minima are intentionally not accepted here. */
export async function resizePanelMirror(read:()=>Promise<Snapshot>,run:MirrorCycleRun,requested:number,observedMin?:number){
 const before=await read();validateSnapshot(before);
 if(!Number.isFinite(requested)||requested<=0||requested>width(before.canvas)||(observedMin!==undefined&&(!Number.isFinite(observedMin)||observedMin<=0||observedMin>width(before.canvas))))throw Error('Alvo/limite de resize inválido.');
 const target=Math.max(requested,observedMin??0),attempts:VerifiedMirrorTrial[]=[];
 let after=before,valid=true,stop_reason='ATTEMPT_LIMIT';
 for(let attempt=1;attempt<=3;attempt++){
  const fresh=await read();sameAnchorObject(before,fresh);
  if(JSON.stringify(fresh)!==JSON.stringify(after))throw Error('Estado alterado fora do controlador de layout.');
  const errorBefore=(width(fresh.bounds)-target)/target;
  if(Math.abs(errorBefore)<=RESIZE_TOLERANCE){stop_reason='WITHIN_TOLERANCE';break;}
  const direction=errorBefore>0?'in':'out',trial=await run(direction,attempt,fresh);attempts.push(trial);
  sameAnchorObject(before,trial.before);sameAnchorObject(before,trial.after);
  if(JSON.stringify(trial.before)!==JSON.stringify(fresh))throw Error('Bounds mudaram antes do resize.');
  after=trial.after;
  if(trial.command_error||!trial.touch_injection.injection_sequence_observed||trial.touch_injection.truncated||!trial.valid||!anchorMetrics(before,after,direction).valid){valid=false;stop_reason='INVALID_GESTURE_OR_INJECTION';break;}
  if(Math.abs(trial.delta_width)<3){valid=false;stop_reason='NO_EFFECT';break;}
  if(trial.direction!==direction||!trial.success||!trial.measured_resize_success||(direction==='in'?trial.delta_width>=0:trial.delta_width<=0)){valid=false;stop_reason='WRONG_DIRECTION_OR_INVALID_EFFECT';break;}
  const errorAfter=(width(after.bounds)-target)/target;
  if(Math.abs(errorAfter)<=RESIZE_TOLERANCE){stop_reason='WITHIN_TOLERANCE';break;}
  if(errorBefore*errorAfter<0){stop_reason='OVERSHOOT_OUTSIDE_TOLERANCE';break;}
 }
 const error=(width(after.bounds)-target)/target;
 return {method:'W3C_EMULATOR_MIRROR',requested_target_width:requested,effective_target_width:target,observed_min_width:observedMin??null,clamped:requested<target,clamp_reason:requested<target?'INSTAGRAM_MIN_SIZE':null,tolerance:RESIZE_TOLERANCE,initial_width:width(before.bounds),final_width:width(after.bounds),error_percent:error*100,attempts,gesture_skipped:attempts.length===0,stop_reason,success:valid&&Math.abs(error)<=RESIZE_TOLERANCE,published:false};
}
