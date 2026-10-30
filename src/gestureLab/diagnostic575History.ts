import {readFile,readdir,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {describe575} from './diagnostic575.js';
import {center,validateSnapshot,type Snapshot} from './core.js';
import {validateSynchronizedTouchActions} from './shortTouchExecution.js';
import {diagnosticTouchTimeline} from './diagnosticTouchTimeline.js';
import type {MirrorPlan,emulatorMirrorActions} from './emulatorMirrorPinch.js';
type HistoricalTrial={direction:string;before:Snapshot;after:Snapshot;plan:MirrorPlan;actions:ReturnType<typeof emulatorMirrorActions>;command_error:string|null;valid:boolean;success:boolean;context?:{text_declared_by_operator?:string;style_index?:number};touch_injection?:{injection_sequence_observed?:boolean;truncated?:boolean;log_file?:string}};
function eligible(raw:unknown):raw is HistoricalTrial{
 try{
  const t=raw as HistoricalTrial;
  validateSnapshot(t.before);validateSnapshot(t.after);validateSynchronizedTouchActions(t.actions);
  return t.direction==='in'&&t.command_error===null&&t.valid===true&&t.plan?.direction==='in'&&Math.abs(t.plan.distance_factor-1/1.2)<1e-9&&t.context?.text_declared_by_operator==='Leia a matéria completa'&&t.context.style_index===0&&t.touch_injection?.injection_sequence_observed===true&&t.touch_injection.truncated===false;
 }catch{return false;}
}
async function reference(file:string,mode:'approved'|'stalled'){
 if((await stat(file)).size>8*1024*1024)throw Error('Relatório histórico excede tamanho permitido.');
 const content=await readFile(file,'utf8'),report=JSON.parse(content);
 if((mode==='approved'&&(report.kind!=='text-emulator-mirror-precision'||report.qualified!==true))||(mode==='stalled'&&(report.kind!=='final-emulator-mirror-benchmark'||report.qualified!==false)))throw Error('Tipo/resultado da referência histórica incompatível.');
 if(report.text_declared_by_operator!=='Leia a matéria completa'||!Array.isArray(report.rounds))throw Error('Relatório histórico não corresponde ao texto padrão.');
 const trials:unknown[]=report.rounds.flatMap((r:{iterations?:unknown[]})=>Array.isArray(r.iterations)?r.iterations:[]);
 const trial=trials.find((t):t is HistoricalTrial=>eligible(t)&&(mode==='approved'?t.success===true&&t.after.bounds.right-t.after.bounds.left<=t.before.bounds.right-t.before.bounds.left-3:t.before.bounds.right-t.before.bounds.left===575&&JSON.stringify(t.before.bounds)===JSON.stringify(t.after.bounds)));
 if(!trial)return null;
 const logName=trial.touch_injection?.log_file?.split(/[\\/]/).at(-1);
 const logPath=logName&&/^[a-zA-Z0-9_-]*touch-injection-logcat\.txt$/.test(logName)?join(dirname(file),logName):null;
 let rawLog:string|null=null;if(logPath)try{rawLog=await readFile(logPath,'utf8');}catch{}
 const geometry={...describe575(trial.before,trial.plan,trial.actions),after_bounds:trial.after.bounds,after_width:trial.after.bounds.right-trial.after.bounds.left,after_height:trial.after.bounds.bottom-trial.after.bounds.top,after_center:center(trial.after.bounds)};
 const prefix=logName?.replace('touch-injection-logcat.txt','');
 return {source_report:file,source_sha256:createHash('sha256').update(content).digest('hex'),before:trial.before,after:trial.after,geometry,
  before_width:geometry.width,after_width:trial.after.bounds.right-trial.after.bounds.left,success:trial.success,
  timeline:rawLog===null?null:diagnosticTouchTimeline(rawLog),timeline_status:rawLog===null?'RAW_LOG_UNAVAILABLE_SUMMARY_ONLY':'RAW_LOG_PARSED',
  injection_summary:trial.touch_injection,
  screenshot_sources:prefix===undefined?null:{before:join(dirname(file),`${prefix}mirror-in-before.png`),after:join(dirname(file),`${prefix}mirror-in-after.png`)}};
}
export async function loadDiagnostic575History(artifacts:string,overrides:{approved?:string;stalled?:string}={}){
 const entries=await readdir(artifacts,{withFileTypes:true});
 const filenames=entries.filter(e=>e.isDirectory()&&/^gesture-text-emulator-pinch-(precision|final)-\d+$/.test(e.name)).map(e=>join(artifacts,e.name,e.name.includes('-precision-')?'text-emulator-precision-report.json':'final-emulator-resize-report.json'));
 const candidates=(await Promise.all(filenames.map(async file=>{try{return {file,time:(await stat(file)).mtimeMs};}catch{return null;}}))).filter((v):v is NonNullable<typeof v>=>v!==null).sort((a,b)=>b.time-a.time);
 const find=async(mode:'approved'|'stalled',override?:string)=>{
  if(override){const r=await reference(override,mode);if(!r)throw Error(`Referência ${mode} não contém gesto elegível.`);return r;}
  for(const {file} of candidates.filter(c=>c.file.endsWith(mode==='approved'?'text-emulator-precision-report.json':'final-emulator-resize-report.json'))){const r=await reference(file,mode);if(r)return r;}
  throw Error(`Referência ${mode} não encontrada nos artefatos locais. Preserve os relatórios precision e final antigos; nenhum gesto enviado.`);
 };
 const approved=await find('approved',overrides.approved),stalled=await find('stalled',overrides.stalled);
 return {approved,stalled,comparison:{approved:approved.geometry,stalled:stalled.geometry},historical_claims:'MEASURED_REPORTS_NOT_A_RECONSTRUCTED_GESTURE'};
}
