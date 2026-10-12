import { randomUUID } from 'node:crypto';
import { ADMIN_TIMEZONE,type PublicationJob,type EventType } from './domain.js';
import type { PublicationsRepository } from './repositories.js';
const confirmedTime=(job:PublicationJob)=>job.published_at ?? job.finished_at;
const day=(date:Date)=>new Intl.DateTimeFormat('en-CA',{ timeZone:ADMIN_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit' }).format(date);
export function publicationStats(jobs:PublicationJob[],now=new Date()) {
  const successful=jobs.filter(job=>job.status==='SUCCESS'),failed=jobs.filter(job=>job.status==='FAILED');
  const completed=jobs.filter(job=>['SUCCESS','FAILED','INCONCLUSIVE'].includes(job.status));
  const timed=successful.flatMap(job=>{ const time=confirmedTime(job);return time ? [new Date(time)] : []; }).filter(date=>date<=now);
  const period=(days:number)=>timed.filter(date=>date.getTime()>=now.getTime()-days*86400000).length;
  const actualTimes=successful.filter(job=>job.published_at).map(job=>new Intl.DateTimeFormat('en-GB',{ timeZone:ADMIN_TIMEZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).format(new Date(job.published_at!)));
  let average:string|null=null;
  if (actualTimes.length) {
    const angles=actualTimes.map(value=>{ const [h,m]=value.split(':').map(Number);return ((h??0)*60+(m??0))/1440*Math.PI*2; });
    const x=angles.reduce((sum,angle)=>sum+Math.cos(angle),0),y=angles.reduce((sum,angle)=>sum+Math.sin(angle),0);
    if(Math.hypot(x,y)>1e-8){ const minute=Math.round((Math.atan2(y,x)+2*Math.PI)%(2*Math.PI)/(2*Math.PI)*1440)%1440;average=`${Math.floor(minute/60).toString().padStart(2,'0')}:${(minute%60).toString().padStart(2,'0')}`; }
  }
  return { today:timed.filter(date=>day(date)===day(now)).length,last24h:period(1),last7d:period(7),last30d:period(30),success:successful.length,failed:failed.length,
    inconclusive:jobs.filter(job=>job.status==='INCONCLUSIVE').length,successRate:completed.length ? successful.length/completed.length*100 : null,
    lastPublication:timed.sort((a,b)=>b.getTime()-a.getTime())[0]?.toISOString() ?? null,averageTime:average,timezone:ADMIN_TIMEZONE };
}
export class PublicationsService {
  constructor(private readonly repository:PublicationsRepository){}
  async dashboard(){ const jobs=await this.repository.listJobs();return { stats:publicationStats(jobs),recent:jobs.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,10) }; }
  async list(query:{ status?:string;type?:string;search?:string;page?:number }={}){
    const text=query.search?.toLocaleLowerCase() ?? '';
    const jobs=(await this.repository.listJobs()).filter(job=>(!query.status || job.status===query.status) && (!query.type || job.media_type===query.type) && (!text || [job.job_id,job.story_url,job.sticker_text,job.media_filename??''].some(value=>value.toLocaleLowerCase().includes(text)))).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
    const page=Math.max(1,query.page??1);return { items:jobs.slice((page-1)*20,page*20),total:jobs.length,page,pageSize:20 };
  }
  async detail(id:string){ const job=await this.repository.findJob(id);return job ? { job,events:await this.repository.listEvents(job.job_id) } : undefined; }
  async events(jobId?:string){ return (await this.repository.listEvents(jobId)).sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp)).slice(0,200); }
  record(job:PublicationJob){ return this.repository.saveJob(job); }
  recordEvent(jobId:string,event:EventType,message:string,metadata?:Record<string,unknown>){ return this.repository.appendEvent({ id:randomUUID(),job_id:jobId,timestamp:new Date().toISOString(),event,message,metadata }); }
}
