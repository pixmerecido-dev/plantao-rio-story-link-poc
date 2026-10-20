import {anchorMetrics,sameAnchorObject} from './anchorCalibration.js';
import {RESIZE_TOLERANCE,width,type Snapshot} from './core.js';
import type {VerifiedMirrorTrial} from './emulatorMirrorCycles.js';
export const CONVERGENCE_FACTORS=[1/1.25,1/1.30,1/1.35] as const;
export async function investigateMirrorConvergence(read:()=>Promise<Snapshot>,run:(factor:number,attempt:number,expected:Snapshot)=>Promise<VerifiedMirrorTrial>,progress:(report:ReturnType<typeof summarize>)=>Promise<void>=async()=>{}){
 const initial=await read(),target=548;
 if(width(initial.bounds)<570||width(initial.bounds)>580)throw Error('Este teste exige o estado preservado próximo de 575 px (570–580). Nenhum gesto enviado.');
 let after=initial,reason='ATTEMPT_LIMIT';const attempts:VerifiedMirrorTrial[]=[];
 for(const [index,factor] of CONVERGENCE_FACTORS.entries()){
  const fresh=await read();sameAnchorObject(initial,fresh);
  if(JSON.stringify(fresh)!==JSON.stringify(after))throw Error('Estado mudou fora do teste.');
  const trial=await run(factor,index+1,fresh);sameAnchorObject(initial,trial.before);sameAnchorObject(initial,trial.after);
  if(JSON.stringify(trial.before)!==JSON.stringify(fresh))throw Error('Estado inicial do gesto divergiu.');
  attempts.push(trial);after=trial.after;
  const valid=!trial.command_error&&trial.touch_injection.injection_sequence_observed&&!trial.touch_injection.truncated&&trial.valid&&anchorMetrics(initial,after,'in').valid;
  const error=(width(after.bounds)-target)/target;
  if(!valid)reason='INVALID_GESTURE_OR_INJECTION';
  else if(trial.delta_width>=3)reason='WRONG_DIRECTION';
  else if(Math.abs(error)<=RESIZE_TOLERANCE&&trial.success)reason='WITHIN_TOLERANCE';
  else if(error<0)reason='OVERSHOOT_OUTSIDE_TOLERANCE';
  else reason=index===2?'ATTEMPT_LIMIT':Math.abs(trial.delta_width)<3?'NO_EFFECT_NEXT_AMPLITUDE':'ABOVE_TARGET_NEXT_AMPLITUDE';
  await progress(summarize(initial,after,attempts,reason));
  if(['INVALID_GESTURE_OR_INJECTION','WRONG_DIRECTION','WITHIN_TOLERANCE','OVERSHOOT_OUTSIDE_TOLERANCE'].includes(reason))break;
 }
 return summarize(initial,after,attempts,reason);
}
function summarize(initial:Snapshot,after:Snapshot,attempts:VerifiedMirrorTrial[],stop_reason:string){
 return {kind:'mirror-convergence-575-548',target_width:548,tolerance:RESIZE_TOLERANCE,initial_width:width(initial.bounds),final_width:width(after.bounds),error_percent:(width(after.bounds)-548)/548*100,attempts:[...attempts],stop_reason,success:stop_reason==='WITHIN_TOLERANCE',preferred_distance_factor:stop_reason==='WITHIN_TOLERANCE'?attempts.at(-1)?.plan.distance_factor:null,minimum_updated:false,benchmark_executed:false,panel_integration:false,published:false};
}
