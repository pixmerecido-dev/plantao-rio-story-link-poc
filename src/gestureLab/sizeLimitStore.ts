import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CURRENT_OBSERVED_LIMIT,limitScopeKey,type ObservedStickerLimit} from '../admin/stickerSizeLimit.js';
export class ObservedSizeLimitStore {
 private tail:Promise<unknown>=Promise.resolve();
 constructor(readonly filename:string){}
 async load():Promise<ObservedStickerLimit[]>{
  try{
   const data=JSON.parse(await readFile(this.filename,'utf8'));
   if(data.version!==1||!Array.isArray(data.limits))throw Error('Registro de limites inválido.');
   for(const l of data.limits) this.validate(l);
   return data.limits;
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
   await this.save(structuredClone(CURRENT_OBSERVED_LIMIT));
   return this.load();
  }
 }
 private validate(l:ObservedStickerLimit){
  const s=l?.scope;
  if(!s||typeof s.text!=='string'||!s.text||![0,1,2,3].includes(s.style_index)||![s.canvas_width,s.canvas_height,l.observed_min_width,l.reference_initial_width].every(v=>Number.isFinite(v)&&v>0)||l.observed_min_width>l.reference_initial_width||l.reference_initial_width>s.canvas_width||typeof s.device!=='string'||!s.device||!(s.instagram_version===null||typeof s.instagram_version==='string')||l.evidence!=='MANUAL_AND_AUTOMATIC')throw Error('Limite observado sem configuração/evidência válida.');
 }
 save(limit:ObservedStickerLimit):Promise<void>{
  this.validate(limit);
  const task=this.tail.then(async()=>{
   await mkdir(dirname(this.filename),{recursive:true});
   let limits:ObservedStickerLimit[]=[];
   try{const data=JSON.parse(await readFile(this.filename,'utf8'));if(data.version!==1||!Array.isArray(data.limits))throw Error('Registro inválido.');limits=data.limits;for(const l of limits)this.validate(l);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
   const next={...structuredClone(limit),recorded_at:new Date().toISOString()};
   limits=limits.filter(l=>limitScopeKey(l.scope)!==limitScopeKey(limit.scope));limits.push(next);
   const temp=`${this.filename}.${randomUUID()}.tmp`;
   try{await writeFile(temp,JSON.stringify({version:1,limits},null,2),{mode:0o600});await rename(temp,this.filename);}finally{await unlink(temp).catch(()=>{});}
  });this.tail=task.catch(()=>{});return task;
 }
}
