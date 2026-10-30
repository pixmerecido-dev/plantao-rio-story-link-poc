import {readFile,open,copyFile,rename,unlink,chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {validateOperationsState,type OperationsState} from './operationsDomain.js';
/** Repair only unescaped U+0000..U+001F inside JSON strings. Never infer missing data. */
export function escapeRawJsonControls(source:string){
 let quoted=false,escaped=false,start=0,line=1,column=1,count=0;
 const parts:string[]=[],locations:{offset:number;line:number;column:number;code_point:string}[]=[];
 for(let i=0;i<source.length;i++){
  const code=source.charCodeAt(i);
  if(quoted){
   if(code<32){
    if(escaped)throw Error('Caractere de controle após barra invertida: reparo ambíguo; arquivo preservado.');
    parts.push(source.slice(start,i),'\\u'+code.toString(16).padStart(4,'0'));start=i+1;count++;
    if(locations.length<20)locations.push({offset:i,line,column,code_point:'U+'+code.toString(16).padStart(4,'0').toUpperCase()});
   }else if(escaped)escaped=false;
   else if(code===92)escaped=true;
   else if(code===34)quoted=false;
  }else if(code===34)quoted=true;
  if(code===10){line++;column=1;}else column++;
 }
 if(quoted||escaped)throw Error('String JSON incompleta; nenhum dado será adivinhado. Arquivo preservado.');
 return {text:count?parts.join('')+source.slice(start):source,count,locations};
}
const sha=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
async function repairLock(filename:string){
 const lock=join(dirname(filename),'backend.lock');
 for(let attempt=0;attempt<2;attempt++){
  try{
   const handle=await open(lock,'wx',0o600);
   try{await handle.writeFile(String(process.pid));}catch(error){await unlink(lock).catch(()=>{});throw error;}finally{await handle.close();}
   return async()=>{if(await readFile(lock,'utf8').catch(()=>null)===String(process.pid))await unlink(lock);};
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
   const content=await readFile(lock,'utf8'),pid=Number(content);
   if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Lock do painel inválido. Arquivo de dados preservado.');
   try{process.kill(pid,0);throw Error('Painel ainda está em execução. Encerre somente o painel antes do reparo.');}
   catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
   if(await readFile(lock,'utf8')!==content)throw Error('Lock mudou durante a verificação. Reparo cancelado.');
   await unlink(lock); // Same stale-lock rule as the backend; never kill a process.
  }
 }
 throw Error('Não foi possível obter exclusividade para reparar.');
}
export async function repairOperationsStore(filename:string,apply=false){
 const release=apply?await repairLock(filename):async()=>{};
 let temp:string|undefined;
 try{
  const original=await readFile(filename),source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(original);
  const candidate=escapeRawJsonControls(source);
  let state:OperationsState;
  try{state=JSON.parse(candidate.text);validateOperationsState(state);}
  catch(error){throw Error('Reparo limitado não produziu um armazenamento válido. Original preservado; não redefinir os dados.',{cause:error});}
  // The validator can migrate an in-memory object. Persist only the original text with escapes,
  // never its reserialized/migrated representation: no records or fields are discarded.
  const summary={filename,status:candidate.count?(apply?'REPAIRED':'REPAIRABLE'):'VALID',raw_control_characters:candidate.count,locations:candidate.locations,
   original_sha256:sha(original),candidate_sha256:sha(candidate.text),queue_count:state.queue.length,account_count:state.instagram_accounts.length,event_count:state.events.length,audit_count:state.audit.length,feed_entry_count:state.feed.entries.length,
   backup:null as string|null,applied:false,publication_executed:false};
  if(!apply||!candidate.count)return summary;
  const backup=`${filename}.before-repair-${Date.now()}-${randomUUID()}.bak`;
  await copyFile(filename,backup,constants.COPYFILE_EXCL);await chmod(backup,0o600);
  if(sha(await readFile(backup))!==summary.original_sha256)throw Error('Dados mudaram ao criar backup. Original não substituído.');
  temp=`${filename}.repair-${randomUUID()}.tmp`;
  const handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(candidate.text,'utf8');await handle.sync();}finally{await handle.close();}
  const prepared=await readFile(temp);
  if(sha(prepared)!==summary.candidate_sha256)throw Error('Arquivo temporário divergiu. Original preservado.');
  validateOperationsState(JSON.parse(prepared.toString('utf8')));
  if(sha(await readFile(filename))!==summary.original_sha256)throw Error('Arquivo original mudou antes da troca. Reparo cancelado.');
  await rename(temp,filename);temp=undefined;
  return {...summary,backup,applied:true};
 }finally{if(temp)await unlink(temp).catch(()=>{});await release();}
}
