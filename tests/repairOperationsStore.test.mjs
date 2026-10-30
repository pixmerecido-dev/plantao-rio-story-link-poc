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
