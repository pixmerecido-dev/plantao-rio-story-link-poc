import { mkdir,readFile,writeFile,rename,unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultSettings,validateSettings,validateJob,validateEvent,type AdminState,type StorySettings,type PublicationJob,type PublicationEvent } from './domain.js';
import type { SettingsRepository,PublicationsRepository } from './repositories.js';
/** Armazenamento local sem addons nativos. Escritas serializadas e substituição atômica. */
export class JsonStorage implements SettingsRepository,PublicationsRepository {
  private state!:AdminState;
  private ready:Promise<void>;
  private tail:Promise<unknown>=Promise.resolve();
  constructor(private readonly filename:string) { this.ready=this.load(); }
  private async load() {
    await mkdir(dirname(this.filename),{ recursive:true });
    try {
      const parsed=JSON.parse(await readFile(this.filename,'utf8')) as AdminState;
      if (parsed.version!==1 || !Array.isArray(parsed.publication_jobs) || !Array.isArray(parsed.publication_events)) throw new Error('Formato do armazenamento inválido.');
      this.state={ version:1,settings:validateSettings(parsed.settings),publication_jobs:parsed.publication_jobs.map(validateJob),publication_events:parsed.publication_events.map(validateEvent) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw new Error('Não foi possível ler o armazenamento; arquivo preservado.',{ cause:error });
      this.state={ version:1,settings:defaultSettings(),publication_jobs:[],publication_events:[] };
      await this.persist(this.state);
    }
  }
  private async persist(state:AdminState) {
    const temporary=`${this.filename}.${randomUUID()}.tmp`;
    try { await writeFile(temporary,`${JSON.stringify(state,null,2)}\n`,{ encoding:'utf8',mode:0o600 }); await rename(temporary,this.filename); }
    finally { await unlink(temporary).catch(()=>{}); }
  }
  private async snapshot() { await this.ready;await this.tail;return structuredClone(this.state); }
  private mutate<T>(callback:(state:AdminState)=>T):Promise<T> {
    const operation=this.tail.then(async()=>{ await this.ready;const next=structuredClone(this.state),result=callback(next);await this.persist(next);this.state=next;return result; });
    this.tail=operation.catch(()=>{});return operation;
  }
  async getSettings(){ return (await this.snapshot()).settings; }
  saveSettings(settings:StorySettings){ return this.mutate(state=>{ state.settings=validateSettings(settings); }); }
  async listJobs(){ return (await this.snapshot()).publication_jobs; }
  async findJob(id:string){ return (await this.listJobs()).find(job=>job.id===id); }
  saveJob(job:PublicationJob){ return this.mutate(state=>{ const valid=validateJob(job),index=state.publication_jobs.findIndex(item=>item.id===job.id);if(index<0)state.publication_jobs.push(valid);else state.publication_jobs[index]=valid; }); }
  async listEvents(jobId?:string){ return (await this.snapshot()).publication_events.filter(event=>!jobId || event.job_id===jobId); }
  appendEvent(event:PublicationEvent){ return this.mutate(state=>{ state.publication_events.push(validateEvent(event)); }); }
  importPublication(job:PublicationJob,event:PublicationEvent){ return this.mutate(state=>{
    if (state.publication_jobs.some(item=>item.source_key===job.source_key)) return false;
    state.publication_jobs.push(validateJob(job));state.publication_events.push(validateEvent(event));return true;
  }); }
}
