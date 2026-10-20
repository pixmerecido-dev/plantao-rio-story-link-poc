import {anchorMetrics,sameAnchorObject} from './anchorCalibration.js';
import {type Snapshot} from './core.js';
import {type MirrorDirection,type testEmulatorMirrorPinch} from './emulatorMirrorPinch.js';
export type VerifiedMirrorTrial=Awaited<ReturnType<typeof testEmulatorMirrorPinch>>&{success:boolean;touch_injection:{injection_sequence_observed:boolean;truncated:boolean}};
export type MirrorCycleRun=(direction:MirrorDirection,cycle:number,expected?:Snapshot)=>Promise<VerifiedMirrorTrial>;
export async function repeatEmulatorMirrorCycles(run:MirrorCycleRun,progress:(report:ReturnType<typeof cycleReport>)=>Promise<void>=async()=>{}){
 const rounds:MirrorCycle[]=[];let expected:Snapshot|undefined,initial:Snapshot|undefined;
 const checked=(trial:VerifiedMirrorTrial,direction:MirrorDirection)=>{
  if(!initial)initial=trial.before;
  try{sameAnchorObject(initial,trial.before);sameAnchorObject(initial,trial.after);}catch{return false;}
  if(expected&&JSON.stringify(expected)!==JSON.stringify(trial.before))return false;
  const valid=trial.direction===direction&&trial.success&&trial.measured_resize_success&&!trial.command_error&&trial.valid&&trial.touch_injection.injection_sequence_observed&&!trial.touch_injection.truncated&&(direction==='out'?trial.delta_width>=3:trial.delta_width<=-3)&&anchorMetrics(initial,trial.after,direction).valid;
  expected=trial.after;return valid;
 };
 for(let cycle=1;cycle<=5;cycle++){
  const increase=await run('out',cycle,expected),outPass=checked(increase,'out');
  let decrease:VerifiedMirrorTrial|null=null,inPass=false;
  if(outPass){decrease=await run('in',cycle,expected);inPass=checked(decrease,'in');}
  const end=decrease??increase;
  rounds.push({cycle,increase,decrease,success:outPass&&inPass,return_error_percent:(end.after_width-increase.before_width)/increase.before_width*100});
  await progress(cycleReport(rounds));if(!outPass||!inPass)break;
 }
 return cycleReport(rounds);
}
type MirrorCycle={cycle:number;increase:VerifiedMirrorTrial;decrease:VerifiedMirrorTrial|null;success:boolean;return_error_percent:number};
function cycleReport(rounds:MirrorCycle[]){
 const passed=rounds.filter(r=>r.success).length;
 return {kind:'short-emulator-mirror-cycles',method:'W3C_EMULATOR_MIRROR',rounds:[...rounds],passed,total:5,qualified:rounds.length===5&&passed===5,
  qualification_scope:'FIVE_OUT_IN_CYCLES_CURRENT_VEJA_CONFIGURATION_ONLY',mean_absolute_return_error_percent:rounds.length?rounds.reduce((s,r)=>s+Math.abs(r.return_error_percent),0)/rounds.length:null,
  exact_target_benchmark_executed:false,panel_integration:false,published:false};
}
