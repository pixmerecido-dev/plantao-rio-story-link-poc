import {open,readFile,writeFile,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {scanOperationsCorruption} from './scanOperationsCorruption.js';
import {validateOperationsState,type OperationsState,type OperationalEvent} from './operationsDomain.js';
import {initialFeedState} from '../ingestion/feedDomain.js';
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
async function fileDigest(filename:string){const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);return hash.digest('hex');}
/** Parse only wholly closed objects in the intact prefix of the events array. */
export function recoverCompleteEvents(prefix:Buffer){
 let i=0;const whitespace=(b:number)=>b===32||b===9||b===10||b===13;
 while(i<prefix.length&&whitespace(prefix[i]!))i++;
 if(prefix[i++]!==91)throw Error('Prefixo de events não começa com array.');
 const events:OperationalEvent[]=[];let needComma=false;
 while(i<prefix.length){
  while(i<prefix.length&&whitespace(prefix[i]!))i++;
  if(i===prefix.length)return {events,partial_item_excluded:false,array_complete:false};
  if(prefix[i]===93)return {events,partial_item_excluded:false,array_complete:true};
  if(needComma){if(prefix[i++]!==44)throw Error('Separador inválido entre eventos completos.');while(i<prefix.length&&whitespace(prefix[i]!))i++;if(i===prefix.length)return {events,partial_item_excluded:false,array_complete:false};}
  const start=i;if(prefix[i]!==123)throw Error('Evento não é objeto JSON; não ignorar registro automaticamente.');
  let depth=0,quoted=false,escaped=false,complete=false;
  for(;i<prefix.length;i++){
   const b=prefix[i]!;
   if(quoted){if(escaped)escaped=false;else if(b===92)escaped=true;else if(b===34)quoted=false;}
   else if(b===34)quoted=true;
   else if(b===123||b===91)depth++;
   else if(b===125||b===93){depth--;if(depth===0){i++;complete=true;break;}}
  }
  if(!complete)return {events,partial_item_excluded:true,partial_item_start_in_prefix:start,array_complete:false};
  const event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(prefix.subarray(start,i))) as OperationalEvent;
  if(!event||typeof event.id!=='string'||!event.id||typeof event.job_id!=='string'||!event.job_id||typeof event.event!=='string'||!event.event||typeof event.message!=='string'||typeof event.timestamp!=='string'||!Number.isFinite(Date.parse(event.timestamp)))throw Error('Evento completo falhou no schema. Nenhum registro será silenciosamente descartado.');
  events.push(event);needComma=true;
 }
 return {events,partial_item_excluded:false,array_complete:false};
}
/** Prepare a reviewable partial recovery. Never overwrite the source or activate the candidate. */
export async function prepareOperationsRecovery(filename:string,expectedSha256:string,progress:(stage:string)=>void=()=>{}){
 if(!/^[a-f0-9]{64}$/.test(expectedSha256))throw Error('SHA256 de referência inválido.');
 progress('SCAN_SOURCE');const survey=await scanOperationsCorruption(filename,bytes=>progress(`SCAN_${bytes}_BYTES`));
 if(survey.sha256!==expectedSha256||survey.source_changed_during_scan)throw Error('Fonte mudou desde a varredura. Não preparar recuperação com evidência antiga.');
 if(survey.nul_run_count!==1||survey.non_nul_bytes_after_first_nul!==0||survey.first_nul_byte_offset===null)throw Error('Este procedimento exige um único bloco NUL até o fim; não se aplica a outra corrupção.');
 const firstNul=survey.first_nul_byte_offset;
 const section=(key:string,required:boolean)=>{
  const found=survey.section_candidates.filter(c=>c.key===key&&c.origin==='BEFORE_FIRST_NUL');
  if(found.length>1)throw Error(`Seção duplicada: ${key}.`);
  const c=found[0];if(c?.status==='JSON_SYNTAX_VALID_CANDIDATE')return c;
  if(required)throw Error(`Seção obrigatória não recuperável: ${key}.`);return undefined;
 };
 const handle=await open(filename,'r');
 const readRange=async(start:number,end:number,maxBytes=64*1024*1024)=>{
  if(start<0||end<=start||end>firstNul||end-start>maxBytes)throw Error('Intervalo de recuperação inválido ou grande demais.');
  const buffer=Buffer.alloc(end-start);let n=0;
  while(n<buffer.length){const r=await handle.read(buffer,n,buffer.length-n,start+n);if(!r.bytesRead)throw Error('Leitura incompleta da fonte.');n+=r.bytesRead;}
  return buffer;
 };
 const recovered:Record<string,unknown>={},unavailable:string[]=[];
 let eventRecovery:ReturnType<typeof recoverCompleteEvents>;
 try{
  for(const key of ['version','instagram_accounts','account_settings','publishing','safety','system','queue','feed','audit','locks']){
   const c=section(key,!['feed','audit','locks'].includes(key));
   if(c)recovered[key]=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readRange(c.start,c.end)));
   else unavailable.push(key);
  }
  const eventSections=survey.section_candidates.filter(c=>c.key==='events'&&c.origin==='BEFORE_FIRST_NUL');
  if(eventSections.length!==1||eventSections[0]!.status!=='INTERRUPTED_BY_NUL'||eventSections[0]!.end!==firstNul)throw Error('Prefixo de eventos interrompido não corresponde à fonte.');
  progress('RECOVER_COMPLETE_EVENTS');
  eventRecovery=recoverCompleteEvents(await readRange(eventSections[0]!.start,firstNul,128*1024*1024));
 }finally{await handle.close();}
 const feed=(recovered.feed??initialFeedState()) as OperationsState['feed'];
 feed.config.enabled=false;feed.config.auto_enqueue=false;
 const state={...recovered,events:eventRecovery.events,feed,audit:recovered.audit??[],locks:recovered.locks??{},
  publishing:{...(recovered.publishing as OperationsState['publishing']),enabled:false},system:{status:'PAUSED',reason:'Recuperação parcial pendente de revisão; automação desativada.'}} as OperationsState;
 progress('VALIDATE_CANDIDATE');validateOperationsState(structuredClone(state));
 const text=JSON.stringify(state,null,2)+'\n',candidateSha=digest(text),sourceQueueSha=digest(JSON.stringify(recovered.queue));
 const output=`${filename}.recovery-candidate-${Date.now()}-${randomUUID()}.json`,reportPath=`${output}.report.json`;
 let created=false,reportCreated=false;
 try{
  if(await fileDigest(filename)!==expectedSha256)throw Error('Fonte mudou durante recuperação.');
  progress('WRITE_SEPARATE_CANDIDATE');const target=await open(output,'wx',0o600);created=true;
  try{await target.writeFile(text,'utf8');await target.sync();}finally{await target.close();}
  const stored=await readFile(output);if(digest(stored)!==candidateSha)throw Error('Candidato gravado divergiu.');
  const verified=JSON.parse(stored.toString('utf8')) as OperationsState;validateOperationsState(structuredClone(verified));
  if(digest(JSON.stringify(verified.queue))!==sourceQueueSha)throw Error('Fila divergiu da seção original.');
  if(await fileDigest(filename)!==expectedSha256)throw Error('Fonte mudou antes de concluir.');
  const report={kind:'operations-partial-recovery-candidate',candidate:output,candidate_sha256:candidateSha,candidate_size_bytes:stored.length,source:filename,source_sha256:expectedSha256,source_size_bytes:survey.file_size_bytes,
   source_replaced:false,candidate_activated:false,requires_review_before_activation:true,full_schema_valid:true,
   preserved:{queue_count:state.queue.length,account_count:state.instagram_accounts.length,account_settings_count:Object.keys(state.account_settings).length,queue_sha256:sourceQueueSha,queue_unchanged:true,accounts_unchanged:true,account_settings_unchanged:true,complete_events_count:state.events.length},
   unavailable_sections:unavailable,events_partial_item_excluded:eventRecovery.partial_item_excluded,event_array_reconstructed_from_complete_items_only:true,unrecoverable_nul_tail_bytes:survey.nul_bytes,
   introduced_defaults:{feed:unavailable.includes('feed')?'EMPTY_DISABLED_NOT_RECOVERED':'PRESERVED_ENTRIES_POLLING_DISABLED',audit:unavailable.includes('audit')?'EMPTY_NOT_RECOVERED':'PRESERVED',locks:unavailable.includes('locks')?'EMPTY_NOT_RECOVERED':'PRESERVED'},
   paused:{publishing_enabled:false,system_status:'PAUSED',feed_enabled:false,feed_auto_enqueue:false},publication_executed:false};
  await writeFile(reportPath,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});reportCreated=true;
  return {report,reportPath};
 }catch(error){if(created)await unlink(output).catch(()=>{});if(reportCreated)await unlink(reportPath).catch(()=>{});throw error;}
}
