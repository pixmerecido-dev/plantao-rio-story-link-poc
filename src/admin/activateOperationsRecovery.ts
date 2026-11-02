import {readFile,open,copyFile,chmod,rename,unlink,stat} from 'node:fs/promises';
import {createReadStream,constants} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {validateOperationsState,type OperationsState} from './operationsDomain.js';
import {acquireOperationsBackendLock} from './repairOperationsStore.js';
const digest=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
async function hashFile(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
/** Explicit partial-recovery activation only, with a byte-exact source backup. */
export async function activateOperationsRecovery(filename:string,reportPath:string,expectedCandidateSha:string,acceptPartialRecovery=false){
 if(!acceptPartialRecovery)throw Error('Confirme explicitamente a recuperação parcial antes de ativar.');
 if(!/^[a-f0-9]{64}$/.test(expectedCandidateSha))throw Error('SHA256 do candidato revisado inválido.');
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 if(report.kind!=='operations-partial-recovery-candidate'||report.candidate_sha256!==expectedCandidateSha||report.full_schema_valid!==true||report.source_replaced!==false||report.candidate_activated!==false||report.requires_review_before_activation!==true||!/^[a-f0-9]{64}$/.test(report.source_sha256)||report.preserved?.queue_unchanged!==true||report.preserved?.accounts_unchanged!==true||report.preserved?.account_settings_unchanged!==true)throw Error('Relatório não corresponde ao candidato revisado.');
 const candidateName=typeof report.candidate==='string'?report.candidate.split(/[\\/]/).at(-1):undefined;
 if(!candidateName||!/^operations\.json\.recovery-candidate-[0-9]+-[a-f0-9-]+\.json$/.test(candidateName))throw Error('Nome de candidato inválido.');
 const candidate=join(dirname(filename),candidateName),release=await acquireOperationsBackendLock(filename);
 let temp:string|undefined;
 try{
  if((await stat(candidate)).size>256*1024*1024)throw Error('Candidato grande demais.');
  const bytes=await readFile(candidate);
  if(bytes.length!==report.candidate_size_bytes||digest(bytes)!==expectedCandidateSha)throw Error('Candidato mudou após revisão; ativação cancelada.');
  const state=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)) as OperationsState;
  validateOperationsState(structuredClone(state));
  if(state.queue.length!==report.preserved.queue_count||state.events.length!==report.preserved.complete_events_count||state.instagram_accounts.length!==report.preserved.account_count||Object.keys(state.account_settings).length!==report.preserved.account_settings_count||digest(JSON.stringify(state.queue))!==report.preserved.queue_sha256)throw Error('Contagens ou fila divergiram do relatório revisado.');
  if(state.publishing.enabled!==false||state.system.status!=='PAUSED'||state.feed.config.enabled!==false||state.feed.config.auto_enqueue!==false)throw Error('Candidato não mantém automação e RSS desativados.');
  if(!Array.isArray(report.unavailable_sections)||report.unavailable_sections.some((key:unknown)=>!['feed','audit','locks'].includes(String(key))))throw Error('Seções indisponíveis inesperadas.');
  if(report.unavailable_sections.includes('audit')&&state.audit.length!==0||report.unavailable_sections.includes('locks')&&Object.keys(state.locks).length!==0||report.unavailable_sections.includes('feed')&&state.feed.entries.length!==0)throw Error('Valores novos não correspondem à recuperação parcial revisada.');
  const currentSha=await hashFile(filename);
  const summary={filename,candidate,candidate_sha256:expectedCandidateSha,original_source_sha256:report.source_sha256,preserved:report.preserved,unavailable_sections:report.unavailable_sections,publication_executed:false,automation_enabled:false,feed_enabled:false};
  if(currentSha===expectedCandidateSha)return {...summary,status:'ALREADY_ACTIVATED',source_replaced:false,backup:null};
  if(currentSha!==report.source_sha256||(await stat(filename)).size!==report.source_size_bytes)throw Error('Original mudou desde a preparação. Nenhuma substituição realizada.');
  const backup=`${filename}.before-recovery-${Date.now()}-${randomUUID()}.bak`;
  await copyFile(filename,backup,constants.COPYFILE_EXCL);await chmod(backup,0o600);
  if(await hashFile(backup)!==report.source_sha256)throw Error('Backup não corresponde ao original. Ativação cancelada.');
  temp=`${filename}.activation-${randomUUID()}.tmp`;
  const handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  if(await hashFile(temp)!==expectedCandidateSha||await hashFile(filename)!==report.source_sha256)throw Error('Fonte ou candidato temporário mudou. Ativação cancelada.');
  await rename(temp,filename);temp=undefined;
  return {...summary,status:'ACTIVATED',source_replaced:true,backup};
 }finally{if(temp)await unlink(temp).catch(()=>{});await release();}
}
