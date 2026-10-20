import {anchorMetrics,sameAnchorObject} from './anchorCalibration.js';
import {validateSnapshot,width,type Snapshot} from './core.js';
export type ManualRangeStage='initial'|'maximum'|'minimum';
export interface ManualRangePort{
 waitForEnter(stage:ManualRangeStage):Promise<void>;
 read():Promise<Snapshot>;
 capture(stage:ManualRangeStage):Promise<string>;
 record(value:Record<string,unknown>):Promise<void>;
}
export async function measureManualRange(port:ManualRangePort){
 const stages=[];
 for(const stage of ['initial','maximum','minimum'] as const){
  await port.waitForEnter(stage);
  const snapshot=await port.read();validateSnapshot(snapshot);
  if(stages.length)sameAnchorObject(stages[0]!.snapshot,snapshot);
  const artifact=await port.capture(stage),verified=await port.read();
  if(JSON.stringify(verified)!==JSON.stringify(snapshot))throw Error('Sticker mudou durante a captura. Solte Ctrl/mouse e aguarde estabilizar antes de Enter.');
  const entry={stage,snapshot,width:width(snapshot.bounds),height:snapshot.bounds.bottom-snapshot.bounds.top,artifact};
  stages.push(entry);await port.record(entry);
 }
 const [initial,maximum,minimum]=stages as [typeof stages[number],typeof stages[number],typeof stages[number]];
 const increase=anchorMetrics(initial.snapshot,maximum.snapshot,'out'),decrease=anchorMetrics(maximum.snapshot,minimum.snapshot,'in');
 return {kind:'anchor-manual-range',stages,initial_width:initial.width,maximum_width:maximum.width,minimum_width:minimum.width,
  increase,decrease,manual_increase_confirmed:increase.valid&&increase.directional_effect,manual_decrease_confirmed:decrease.valid&&decrease.directional_effect,
  success:increase.valid&&increase.directional_effect&&decrease.valid&&decrease.directional_effect,
  limits_status:'OPERATOR_REPORTED_EXTREMES_OBSERVED_IN_THIS_RUN_NOT_UNIVERSAL',automated_touch_sent:false,manual_pointer_path_observed:false,geometry_qualification:'NOT_EVALUATED',published:false};
}
