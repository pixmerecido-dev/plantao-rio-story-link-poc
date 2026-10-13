import { readdir,readFile,stat } from 'node:fs/promises';
import { join,basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PublicationJob,PublicationEvent } from './domain.js';
import type { PublicationsRepository } from './repositories.js';
const record=(value:unknown):Record<string,unknown>=>value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
const text=(value:unknown)=>typeof value==='string' ? value : null;
/** Lê somente resumos já escritos pelo motor. Não instrumenta nem executa Instagram. */
export class ArtifactImporter {
  private running:Promise<{ imported:number;skipped:number;warnings:string[] }>|undefined;
  constructor(private readonly repository:PublicationsRepository,private readonly directory:string){}
  sync(){ if(!this.running)this.running=this.import().finally(()=>{ this.running=undefined; });return this.running; }
  private async import(){
    const report={ imported:0,skipped:0,warnings:[] as string[] };
    let entries;
    try{ entries=await readdir(this.directory,{ withFileTypes:true }); }catch(error){ if((error as NodeJS.ErrnoException).code==='ENOENT')return report;throw error; }
    for(const entry of entries){
      const match=/^(story-end-to-end-real|story-prepare)-(\d+)$/.exec(entry.name);
      if(!entry.isDirectory() || !match)continue;
      const filename=join(this.directory,entry.name,'summary.json');
      try{
        const info=await stat(filename);
        if(info.size>8*1024*1024){ report.warnings.push(`${entry.name}: resumo maior que o limite.`);continue; }
        const summary=record(JSON.parse(await readFile(filename,'utf8'))),prepared=record(summary.prepared ?? summary),rawMedia=record(prepared.media),publication=record(summary.publication);
        const legacyPath=text(prepared.image);
        const media=Object.keys(rawMedia).length ? rawMedia : legacyPath ? { path:legacyPath,type:'IMAGE',filename:basename(legacyPath) } : {};
        const jobId=text(summary.job_id ?? prepared.job_id),url=text(prepared.story_url),stickerText=text(prepared.sticker_text);
        if(!jobId || !url || stickerText===null || !text(media.path)){ report.skipped++;continue; }
        const created=Number(match[2]);if(!Number.isFinite(created) || !Number.isFinite(new Date(created).getTime()))throw new Error('Data do diretório inválida.');
        const finished=info.mtime.toISOString(),outcome=text(publication.outcome);
        const status=outcome==='SUCCESS' ? 'SUCCESS' : outcome==='FAILURE' ? 'FAILED' : outcome==='INCONCLUSIVE' ? 'INCONCLUSIVE' : match[1]==='story-prepare' ? 'READY' : 'INCONCLUSIVE';
        const account=record(summary.account_verification);
        const accountName=text(account.account_detected), expectedName=text(account.account_expected);
        const verifiedAccount=account.account_match===true && !!accountName && !!expectedName && accountName.replace(/^@/,'').toLowerCase()===expectedName.replace(/^@/,'').toLowerCase() && !!text(account.account_verified_at) && Number.isFinite(Date.parse(String(account.account_verified_at)));
        const layout=record(prepared.layout);
        let resize:Record<string,unknown>={};
        try{resize=record(JSON.parse(await readFile(join(this.directory,entry.name,'layout','resize','resize-test.json'),'utf8')));}catch{/* Resize pode ter sido pulado. Não inventar a escala aplicada. */}
        const bounds=typeof layout.bounds==='string' ? /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(layout.bounds) : null;
        const actualX=bounds ? (Number(bounds[1])+Number(bounds[3]))/2 : null;
        const actualY=bounds ? (Number(bounds[2])+Number(bounds[4]))/2 : null;
        // Não inferir horário de publicação do retorno à Home; o resumo atual não expõe esse horário.
        const job:PublicationJob={ ...(verifiedAccount ? {account_id:text(summary.account_id)??undefined,instagram_username:accountName} : {}), id:randomUUID(),job_id:jobId,created_at:new Date(created).toISOString(),started_at:new Date(created).toISOString(),finished_at:finished,published_at:null,
          media_path:text(media.path),media_type:media.type==='VIDEO' ? 'VIDEO' : media.type==='IMAGE' ? 'IMAGE' : 'UNSUPPORTED',media_filename:text(media.filename),story_url:url,sticker_text:stickerText,
          sticker_scale:typeof prepared.sticker_scale==='number' ? prepared.sticker_scale : typeof resize.scale_ratio==='number' ? resize.scale_ratio : null,
          sticker_x:actualX,sticker_y:actualY,
          instagram_status:status,facebook_crosspost:typeof publication.facebook_crosspost_enabled==='boolean' ? publication.facebook_crosspost_enabled : null,
          status,attempts:typeof publication.clickCount==='number' ? publication.clickCount : 0,duration_ms:Math.max(0,info.mtimeMs-created),
          error_code:status==='FAILED' ? 'ENGINE_FAILURE' : null,error_message:text(publication.clickError) ?? (Array.isArray(publication.observationErrors) && publication.observationErrors.length ? publication.observationErrors.map(String).join('\n') : null),
          source_key:entry.name,source_note:'Resumo local do motor. Início pelo timestamp do diretório; término pela gravação do resumo. Horário exato de publicação indisponível. Crosspost indica configuração aceita, não entrega confirmada no Facebook.' };
        // Evento de auditoria de importação, não inventa timestamps de passos anteriores.
        const event:PublicationEvent={ id:randomUUID(),job_id:jobId,timestamp:new Date().toISOString(),event:'ARTIFACT_IMPORTED',message:'Resumo real do motor importado para o histórico.',metadata:{ source:entry.name,outcome:status,layout_confirmed:prepared.layout_confirmed===true,publication_click_count:job.attempts } };
        if(await this.repository.importPublication(job,event))report.imported++;else report.skipped++;
      }catch(error){ if((error as NodeJS.ErrnoException).code==='ENOENT'){ report.skipped++;continue; }report.warnings.push(`${entry.name}: não foi possível importar o resumo.`); }
    }
    return report;
  }
}
