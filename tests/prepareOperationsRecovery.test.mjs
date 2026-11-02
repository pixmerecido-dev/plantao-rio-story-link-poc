import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {initialOperationsState,validateOperationsState} from '../dist/admin/operationsDomain.js';
import {prepareOperationsRecovery,recoverCompleteEvents} from '../dist/admin/prepareOperationsRecovery.js';
const sha=data=>createHash('sha256').update(data).digest('hex');
const event=i=>({id:'event-'+i,job_id:'job-0',timestamp:'2026-11-02T00:00:00.000Z',event:'TEST',message:i===2?'PARTIAL-DAMAGE-SENTINEL':'ação: nested braces { [ ] } and quote "'});
function sourceFixture(){
 const initial=initialOperationsState();initial.account_settings['instagram-default'].story.sticker.enabled=false;initial.publishing.enabled=true;initial.system.status='ONLINE';
 initial.queue=Array.from({length:86},(_,i)=>({id:'id-'+i,job_id:'job-'+i,account_id:'instagram-default',instagram_username:null,media_path:'C:\\photos\\'+i+'.jpg',media_type:'IMAGE',media_filename:i+'.jpg',media_hash:'hash-'+i,story_url:'https://example.com/'+i,sticker_text:'Preservar texto '+i,priority:'NORMAL',mode:'AUTO_QUEUE',scheduled_at:null,created_at:'2026-11-02T00:00:00.000Z',started_at:null,finished_at:null,published_at:null,status:'QUEUED',attempts:0,duration_ms:null,error_code:null,error_message:null,dedup_key:'key-'+i,order:i,effective_settings:null,facebook_crosspost:null,attempt_history:[]}));
 const state={version:initial.version,instagram_accounts:initial.instagram_accounts,account_settings:initial.account_settings,publishing:initial.publishing,safety:initial.safety,system:initial.system,queue:initial.queue,events:[event(0),event(1),event(2)],audit:initial.audit,locks:initial.locks,feed:initial.feed};
 validateOperationsState(structuredClone(state));const full=JSON.stringify(state,null,2),cut=full.indexOf('PARTIAL-DAMAGE-SENTINEL')+5;
 return {state,buffer:Buffer.concat([Buffer.from(full.slice(0,cut)),Buffer.alloc(128)])};
}
async function fixture(buffer,fn){const root=await mkdtemp(join(tmpdir(),'ops-candidate-')),file=join(root,'operations.json');try{await writeFile(file,buffer);await fn(file,root);}finally{await rm(root,{recursive:true,force:true});}}
test('prepares a full-schema candidate preserving all 86 jobs, account settings and complete events, without activating it',async()=>{
 const {state,buffer}=sourceFixture();await fixture(buffer,async(file,root)=>{
  const {report,reportPath}=await prepareOperationsRecovery(file,sha(buffer));const candidate=JSON.parse(await readFile(report.candidate,'utf8'));validateOperationsState(structuredClone(candidate));
  assert.deepEqual(candidate.queue,state.queue);assert.deepEqual(candidate.account_settings,state.account_settings);assert.deepEqual(candidate.instagram_accounts,state.instagram_accounts);assert.deepEqual(candidate.events,[event(0),event(1)]);
  assert.equal(candidate.publishing.enabled,false);assert.equal(candidate.system.status,'PAUSED');assert.equal(candidate.feed.config.enabled,false);assert.equal(candidate.feed.config.auto_enqueue,false);
  assert.deepEqual(candidate.audit,[]);assert.deepEqual(candidate.locks,{});assert.equal(report.preserved.queue_count,86);assert.equal(report.preserved.complete_events_count,2);assert.equal(report.events_partial_item_excluded,true);assert.deepEqual(report.unavailable_sections,['feed','audit','locks']);assert.equal(report.candidate_activated,false);assert.equal(report.source_replaced,false);assert.equal(report.requires_review_before_activation,true);assert.equal(report.publication_executed,false);
  assert.deepEqual(await readFile(file),buffer);assert.equal((await readdir(root)).length,3);assert.equal(JSON.parse(await readFile(reportPath,'utf8')).candidate_sha256,sha(await readFile(report.candidate)));
 });
});
test('stale survey hash, interior NUL corruption, or incomplete queue cannot produce a candidate',async()=>{
 const {buffer}=sourceFixture();await fixture(buffer,async(file,root)=>{await assert.rejects(prepareOperationsRecovery(file,'0'.repeat(64)),/mudou/);assert.deepEqual(await readdir(root),['operations.json']);});
 const interior=Buffer.concat([buffer,Buffer.from('not a zero tail')]);await fixture(interior,async(file,root)=>{await assert.rejects(prepareOperationsRecovery(file,sha(interior)),/único bloco/);assert.deepEqual(await readdir(root),['operations.json']);});
 const missing=Buffer.from('{\n  "version": 1,\n  "queue": ['+'\0'.repeat(100));await fixture(missing,async(file,root)=>{await assert.rejects(prepareOperationsRecovery(file,sha(missing)),/obrigatória/);assert.deepEqual(await readdir(root),['operations.json']);});
});
test('complete event objects are never skipped when their syntax or schema is invalid',()=>{
 assert.throws(()=>recoverCompleteEvents(Buffer.from('[{"id":"x"}, {"cut":')),/schema/);
 assert.throws(()=>recoverCompleteEvents(Buffer.from('['+JSON.stringify(event(0))+' '+JSON.stringify(event(1)))),/Separador/);
 assert.throws(()=>recoverCompleteEvents(Buffer.from('[null,')),/não é objeto/);
 const prefix=Buffer.from('['+JSON.stringify(event(0))+', {"id":"cut');const r=recoverCompleteEvents(prefix);assert.deepEqual(r.events,[event(0)]);assert.equal(r.partial_item_excluded,true);assert.equal(r.array_complete,false);
});
