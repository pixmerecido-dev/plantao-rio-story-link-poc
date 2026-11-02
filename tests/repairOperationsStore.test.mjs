import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {escapeRawJsonControls,repairOperationsStore} from '../dist/admin/repairOperationsStore.js';
import {initialOperationsState} from '../dist/admin/operationsDomain.js';
function damaged(){const state=initialOperationsState();state.account_settings['instagram-default'].story.sticker.enabled=false;state.events.push({id:'e',job_id:'job',event:'TEST',message:'ação\nsegunda linha\tfinal',timestamp:new Date().toISOString()});const good=JSON.stringify(state,null,2)+'\n';return {state,source:good.replace('ação\\nsegunda linha\\tfinal','ação\nsegunda linha\tfinal')};}
test('escapes controls only within strings; preserves punctuation, whitespace and existing escapes',()=>{
 const source=' {\r\n"a":"raw\tline\nnext\u0000", "b":"quoted\\\" and \\\\ path", "n":1}\r\n';
 const r=escapeRawJsonControls(source);assert.equal(r.count,3);assert.equal(JSON.parse(r.text).a,'raw\tline\nnext\u0000');assert.ok(r.text.startsWith(' {\r\n'));assert.ok(r.text.endsWith('}\r\n'));assert.equal(JSON.parse(r.text).b,'quoted" and \\ path');assert.equal(escapeRawJsonControls(r.text).count,0);
 assert.throws(()=>escapeRawJsonControls('{"x":"bad\\\n"}'),/ambíguo/);assert.throws(()=>escapeRawJsonControls('{"x":"truncated'),/incompleta/);
});
test('diagnosis never writes; apply preserves exact original backup and only escapes corrupted strings',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ops-repair-')),file=join(root,'operations.json');
 try{const {state,source}=damaged();await writeFile(file,source);const dry=await repairOperationsStore(file);assert.equal(dry.status,'REPAIRABLE');assert.equal(dry.applied,false);assert.equal(await readFile(file,'utf8'),source);assert.deepEqual(await readdir(root),['operations.json']);
 const fixed=await repairOperationsStore(file,true);assert.equal(fixed.applied,true);assert.equal(fixed.raw_control_characters,2);assert.equal(await readFile(fixed.backup,'utf8'),source);assert.deepEqual(JSON.parse(await readFile(file,'utf8')),state);assert.equal(fixed.publication_executed,false);assert.equal((await readdir(root)).includes('backend.lock'),false);
 const again=await repairOperationsStore(file,true);assert.equal(again.status,'VALID');assert.equal(again.applied,false);assert.equal(again.backup,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('structural corruption, invalid schema or invalid UTF8 never replace or reset a store',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ops-invalid-')),file=join(root,'operations.json');
 try{for(const source of [Buffer.from('{"queue":['),Buffer.from('{"value":"raw\nline"}'),Buffer.from([0xff,0xfe,0x00]),Buffer.from('\ufeff'+JSON.stringify(initialOperationsState()))]){await writeFile(file,source);await assert.rejects(repairOperationsStore(file,true));assert.deepEqual(await readFile(file),source);assert.deepEqual(await readdir(root),['operations.json']);}}
 finally{await rm(root,{recursive:true,force:true});}
});
test('live backend lock prevents repair and does not remove the lock or original',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ops-locked-')),file=join(root,'operations.json'),lock=join(root,'backend.lock'),{source}=damaged();
 try{await writeFile(file,source);await writeFile(lock,String(process.pid));await assert.rejects(repairOperationsStore(file,true),/em execução/);assert.equal(await readFile(file,'utf8'),source);assert.equal(await readFile(lock,'utf8'),String(process.pid));assert.equal((await readdir(root)).length,2);}
 finally{await rm(root,{recursive:true,force:true});}
});
test('large control sequences use bounded chunks and retain the exact decoded string',()=>{
 const value='prefix'+'\u0000'.repeat(50000)+'suffix',r=escapeRawJsonControls('{"message":"'+value+'"}');
 assert.equal(r.count,50000);assert.equal(r.locations.length,20);assert.equal(JSON.parse(r.text).message,value);
});
test('excessive corruption and oversized files stop before replacement, preserving original bytes',async()=>{
 const {MAX_CONTROL_REPAIRS,MAX_REPAIR_FILE_BYTES,OperationsRepairScanError}=await import('../dist/admin/repairOperationsStore.js');
 const {open,stat}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'ops-bounded-')),file=join(root,'operations.json');
 try{
  const source=Buffer.from('{"message":"'+'\u0000'.repeat(MAX_CONTROL_REPAIRS+1)+'"}');await writeFile(file,source);
  await assert.rejects(repairOperationsStore(file,true),e=>e instanceof OperationsRepairScanError&&e.diagnostic.reason==='CONTROL_REPAIR_LIMIT');assert.deepEqual(await readFile(file),source);assert.deepEqual(await readdir(root),['operations.json']);
  const handle=await open(file,'w');try{await handle.truncate(MAX_REPAIR_FILE_BYTES+1);}finally{await handle.close();}
  const steps=[];await assert.rejects(repairOperationsStore(file,true,s=>steps.push(s)),/acima do limite/);assert.equal((await stat(file)).size,MAX_REPAIR_FILE_BYTES+1);assert.equal(steps.at(-1).stage,'READ');assert.deepEqual(await readdir(root),['operations.json']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('CLI failures produce a small stage diagnostic without echoing private store contents',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const {resolve}=await import('node:path');
 const run=promisify(execFile),root=await mkdtemp(join(tmpdir(),'ops-cli-')),file=join(root,'operations.json');
 try{
  const original='{ "private":"do-not-echo-this", "message":"'+'\u0000'.repeat(100001)+'"}';await writeFile(file,original);
  await assert.rejects(run(process.execPath,[resolve('dist/utils/repairOperationsCli.js')],{env:{...process.env,ADMIN_DATA_DIR:root}}),e=>{assert.ok(!e.stderr.includes('do-not-echo-this'));return e.code===1;});
  const name=(await readdir(root)).find(n=>n.includes('.repair-diagnostic-'));assert.ok(name);const report=JSON.parse(await readFile(join(root,name),'utf8'));
  assert.equal(report.stage,'SCAN_CONTROLS');assert.equal(report.original_file_replaced,false);assert.equal(report.details.reason,'CONTROL_REPAIR_LIMIT');assert.equal(await readFile(file,'utf8'),original);
 }finally{await rm(root,{recursive:true,force:true});}
});
