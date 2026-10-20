import {createHash} from 'node:crypto';
import {readFile,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {sameAnchorObject} from './anchorCalibration.js';
import {validateSnapshot,width,type Snapshot} from './core.js';
import type {ObservedStickerLimit,StickerLimitScope} from '../admin/stickerSizeLimit.js';
export interface SessionMinimumObservation {
 version:1;scope:StickerLimitScope;observed_min_width:number;reference_snapshot:Snapshot;
 evidence:'AUTOMATIC_STALL_AND_OPERATOR_MANUAL_CONFIRMATION';source_report:string;source_sha256:string;
 recorded_at:string;session_only:true;historical_limit_preserved:true;
}
export function confirmSessionMinimum(raw:unknown,current:Snapshot,scope:StickerLimitScope,source_report:string,source_sha256:string):SessionMinimumObservation{
 validateSnapshot(current);
 const d=raw as Record<string,any>;
 if(scope.text!=='Leia a matéria completa'||scope.style_index!==0||scope.device!==current.device||scope.canvas_width!==width(current.canvas)||scope.canvas_height!==current.canvas.bottom-current.canvas.top)throw Error('Configuração não corresponde ao controle manual desta sessão.');
 if(!d||d.kind!=='mirror-convergence-575-548'||d.success!==false||d.stop_reason!=='ATTEMPT_LIMIT'||!Array.isArray(d.attempts)||d.attempts.length!==3)throw Error('Exige relatório completo das três amplitudes sem efeito; nenhum limite aprendido automaticamente.');
 const seen=new Set<number>();
 for(const trial of d.attempts){
  validateSnapshot(trial.before);validateSnapshot(trial.after);sameAnchorObject(current,trial.before);sameAnchorObject(current,trial.after);
  if(JSON.stringify(trial.before)!==JSON.stringify(current)||JSON.stringify(trial.after)!==JSON.stringify(current)||trial.direction!=='in'||trial.command_error!==null||trial.valid!==true||trial.delta_width!==0||trial.context?.text_declared_by_operator!==scope.text||trial.context?.style_index!==scope.style_index||(trial.context?.instagram_version??null)!==scope.instagram_version||trial.touch_injection?.injection_sequence_observed!==true||trial.touch_injection?.truncated!==false)throw Error('Evidência antiga, incompleta ou estado alterado. Não reutilizar mínimo desta sessão.');
  const factor=trial.plan?.distance_factor;
  if(!Number.isFinite(factor)||factor<.7||factor>=1)throw Error('Amplitude de evidência inválida.');seen.add(factor);
 }
 if(seen.size!==3||width(current.bounds)!==575||d.initial_width!==575||d.final_width!==575)throw Error('O controle manual confirmado exige o mesmo estado de 575 px.');
 return {version:1,scope:{...scope},observed_min_width:575,reference_snapshot:structuredClone(current),evidence:'AUTOMATIC_STALL_AND_OPERATOR_MANUAL_CONFIRMATION',source_report,source_sha256,recorded_at:new Date().toISOString(),session_only:true,historical_limit_preserved:true};
}
export async function loadSessionMinimum(artifacts:string,current:Snapshot,scope:StickerLimitScope){
 const entries=await readdir(artifacts,{withFileTypes:true});
 const candidates=await Promise.all(entries.filter(e=>e.isDirectory()&&e.name.startsWith('gesture-text-emulator-pinch-converge-')).map(async e=>{const path=join(artifacts,e.name,'mirror-convergence-report.json');try{return {path,time:(await stat(path)).mtimeMs};}catch{return null;}}));
 const latest=candidates.filter((c):c is NonNullable<typeof c>=>c!==null).sort((a,b)=>b.time-a.time)[0];
 if(!latest)throw Error('Relatório de convergência não encontrado em artifacts.');
 const data=await readFile(latest.path,'utf8');
 return confirmSessionMinimum(JSON.parse(data),current,scope,latest.path,createHash('sha256').update(data).digest('hex'));
}
export function sessionPrecisionLimit(observation:SessionMinimumObservation,current:Snapshot,text:string):ObservedStickerLimit{
 if(observation.version!==1||observation.session_only!==true||observation.evidence!=='AUTOMATIC_STALL_AND_OPERATOR_MANUAL_CONFIRMATION'||observation.scope.text!==text||JSON.stringify(observation.reference_snapshot)!==JSON.stringify(current)||observation.observed_min_width!==width(current.bounds))throw Error('Observação de sessão não corresponde ao estado inicial.');
 return {scope:{...observation.scope},observed_min_width:observation.observed_min_width,reference_initial_width:width(current.bounds),evidence:'MANUAL_AND_AUTOMATIC',recorded_at:observation.recorded_at};
}
