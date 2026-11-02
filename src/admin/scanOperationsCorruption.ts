import {createReadStream} from 'node:fs';
import {open,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateSettings} from './domain.js';
const KEYS=new Set(['version','feed','instagram_accounts','account_settings','publishing','safety','system','queue','events','audit','locks']);
type Candidate={key:string;start:number;end:number;status:string;origin:string;json_type?:string;item_count?:number;settings_schema_valid?:boolean};
type Active={key:string;start:number;origin:string;kind:'waiting'|'object'|'string'|'primitive';depth:number;quoted:boolean;escaped:boolean};
/** Read-only byte survey. Sections are candidates, never an authorization to restore or discard data. */
export async function scanOperationsCorruption(filename:string,progress:(bytes:number)=>void=()=>{},chunkSize=1024*1024){
 const before=await stat(filename),hash=createHash('sha256');
 let offset=0,nuls=0,firstNul:number|null=null,lastNul:number|null=null,runStart:number|null=null,runCount=0,nonNulAfterFirst=0,nextProgress=16*1024*1024;
 const runs:{start_byte:number;end_byte_exclusive:number;length:number}[]=[],candidates:Candidate[]=[];
 let longest:{start_byte:number;end_byte_exclusive:number;length:number}|null=null,line='',lineOverflow=false,active:Active|null=null;
 const closeRun=(end:number)=>{if(runStart===null)return;const r={start_byte:runStart,end_byte_exclusive:end,length:end-runStart};runCount++;if(runs.length<32)runs.push(r);if(!longest||r.length>longest.length)longest=r;runStart=null;};
 const finish=(end:number,status='COMPLETE_CANDIDATE')=>{if(active&&candidates.length<128)candidates.push({key:active.key,start:active.start,end,status,origin:active.origin});active=null;};
 for await(const raw of createReadStream(filename,{highWaterMark:chunkSize})){
  const chunk=raw as Buffer;hash.update(chunk);
  for(const byte of chunk){
   if(byte===0){nuls++;firstNul??=offset;lastNul=offset;runStart??=offset;if(active)finish(offset,'INTERRUPTED_BY_NUL');}
   else {closeRun(offset);if(firstNul!==null)nonNulAfterFirst++;}
   // Only recognize exact pretty-printed known root headers. Post-corruption headers
   // are explicitly unauthenticated candidates and may not be used as a full store.
   if(byte===10){line='';lineOverflow=false;}
   else if(!lineOverflow){if(line.length<128)line+=String.fromCharCode(byte);else lineOverflow=true;}
   if(byte===58&&!lineOverflow){
    const match=/^  "([a-z_]+)":$/.exec(line);
    if(match&&KEYS.has(match[1]!)){
     if(active)finish(offset,'INTERRUPTED_BY_NEXT_HEADER');
     active={key:match[1]!,start:offset+1,origin:firstNul===null?'BEFORE_FIRST_NUL':'AFTER_CORRUPTION_UNAUTHENTICATED',kind:'waiting',depth:0,quoted:false,escaped:false};offset++;continue;
    }
   }
   if(active&&byte!==0){
    const whitespace=byte===32||byte===9||byte===10||byte===13;
    if(active.kind==='waiting'){
     if(!whitespace){active.start=offset;active.kind=byte===123||byte===91?'object':byte===34?'string':'primitive';active.depth=active.kind==='object'?1:0;active.quoted=byte===34;}
    }else if(active.quoted){
     if(active.escaped)active.escaped=false;
     else if(byte===92)active.escaped=true;
     else if(byte===34){active.quoted=false;if(active.kind==='string')finish(offset+1);}
    }else if(active.kind==='primitive'){
     if(whitespace||byte===44||byte===125)finish(offset);
    }else if(byte===34)active.quoted=true;
    else if(byte===123||byte===91)active.depth++;
    else if(byte===125||byte===93){active.depth--;if(active.depth===0)finish(offset+1);}
   }
   offset++;
  }
  if(offset>=nextProgress){progress(offset);nextProgress=offset+16*1024*1024;}
 }
 closeRun(offset);if(active)finish(offset,'INCOMPLETE_AT_EOF');progress(offset);
 const handle=await open(filename,'r');
 try{
  for(const candidate of candidates){
   if(candidate.status!=='COMPLETE_CANDIDATE')continue;
   const length=candidate.end-candidate.start;
   if(length<=0||length>64*1024*1024){candidate.status='NOT_PARSED_SIZE_LIMIT';continue;}
   const buffer=Buffer.alloc(length);let read=0;
   while(read<length){const result=await handle.read(buffer,read,length-read,candidate.start+read);if(!result.bytesRead)break;read+=result.bytesRead;}
   try{
    if(read!==length)throw Error('Short read');
    const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer));
    candidate.status='JSON_SYNTAX_VALID_CANDIDATE';candidate.json_type=Array.isArray(value)?'array':value===null?'null':typeof value;
    if(Array.isArray(value))candidate.item_count=value.length;
    else if(value&&typeof value==='object')candidate.item_count=Object.keys(value).length;
    if(candidate.key==='account_settings'){
     try{if(!value||typeof value!=='object'||Array.isArray(value))throw Error();for(const setting of Object.values(value))validateSettings(setting);candidate.settings_schema_valid=true;}catch{candidate.settings_schema_valid=false;}
    }
   }catch{candidate.status='INVALID_JSON_CANDIDATE';}
  }
 }finally{await handle.close();}
 const after=await stat(filename);
 const changed=before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino||offset!==before.size;
 return {kind:'operations-corruption-survey',filename,file_size_bytes:offset,sha256:hash.digest('hex'),source_changed_during_scan:changed,nul_bytes:nuls,nul_run_count:runCount,first_nul_byte_offset:firstNul,last_nul_byte_offset:lastNul,longest_nul_run:longest,first_nul_runs:runs,nul_runs_list_truncated:runCount>runs.length,non_nul_bytes_after_first_nul:nonNulAfterFirst,
  section_candidates:candidates,interpretation:'SYNTAX_ONLY_NOT_COMPLETE_STORE_VALIDATION_OR_RESTORE',source_replaced:false,records_deleted:false,publication_executed:false};
}
