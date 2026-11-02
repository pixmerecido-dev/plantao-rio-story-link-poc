import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {scanOperationsCorruption} from '../dist/admin/scanOperationsCorruption.js';
import {initialOperationsState} from '../dist/admin/operationsDomain.js';
async function withFile(source,fn){const root=await mkdtemp(join(tmpdir(),'ops-survey-')),file=join(root,'operations.json');try{await writeFile(file,source);await fn(file,root);}finally{await rm(root,{recursive:true,force:true});}}
test('finds NUL runs across chunks, preserves source, and identifies later settings as candidates only',async()=>{
 const state=initialOperationsState();state.feed.note='ação'+'\0'.repeat(10)+'tail';state.account_settings['instagram-default'].story.sticker.enabled=false;
 const source=Buffer.from(JSON.stringify(state,null,2).replace('\\u0000'.repeat(10),'\0'.repeat(10)));
 await withFile(source,async(file,root)=>{const r=await scanOperationsCorruption(file,()=>{},7);assert.equal(r.nul_bytes,10);assert.equal(r.nul_run_count,1);assert.equal(r.first_nul_byte_offset,source.indexOf(0));assert.equal(r.longest_nul_run.length,10);assert.equal(r.non_nul_bytes_after_first_nul>0,true);assert.equal(r.sha256,createHash('sha256').update(source).digest('hex'));assert.equal(r.source_changed_during_scan,false);
 const feed=r.section_candidates.find(c=>c.key==='feed');assert.equal(feed.status,'INTERRUPTED_BY_NUL');const settings=r.section_candidates.find(c=>c.key==='account_settings');assert.equal(settings.status,'JSON_SYNTAX_VALID_CANDIDATE');assert.equal(settings.settings_schema_valid,true);assert.equal(settings.origin,'AFTER_CORRUPTION_UNAUTHENTICATED');assert.deepEqual(await readFile(file),source);assert.deepEqual(await readdir(root),['operations.json']);});
});
test('valid store recognizes pretty-printed sections without exposing stored values',async()=>{
 const state=initialOperationsState();state.events.push({message:'private-do-not-print; braces { [ ] } and escaped quote "',id:'x'});
 await withFile(JSON.stringify(state,null,2),async file=>{const r=await scanOperationsCorruption(file);assert.equal(r.nul_bytes,0);assert.equal(r.first_nul_byte_offset,null);assert.equal(r.section_candidates.find(c=>c.key==='events').item_count,1);assert.ok(!JSON.stringify(r).includes('private-do-not-print'));assert.ok(r.section_candidates.every(c=>c.status==='JSON_SYNTAX_VALID_CANDIDATE'));assert.equal(r.source_replaced,false);assert.equal(r.records_deleted,false);});
});
test('zero-filled tail is measured as missing material rather than invented JSON closure',async()=>{
 const source=Buffer.from('{\n  "version": 1,\n  "feed": {\n    "note": "broken'+'\0'.repeat(1024));
 await withFile(source,async file=>{const r=await scanOperationsCorruption(file,()=>{},11);assert.equal(r.nul_bytes,1024);assert.equal(r.non_nul_bytes_after_first_nul,0);assert.equal(r.longest_nul_run.end_byte_exclusive,source.length);assert.equal(r.section_candidates.find(c=>c.key==='feed').status,'INTERRUPTED_BY_NUL');assert.equal(r.section_candidates.some(c=>c.key==='account_settings'),false);});
});
test('run list is bounded and incomplete JSON is not called a complete section',async()=>{
 const source=Buffer.from('{\n  "events": ["'+('a\0'.repeat(100))+'unfinished');
 await withFile(source,async file=>{const r=await scanOperationsCorruption(file,()=>{},13);assert.equal(r.nul_run_count,100);assert.equal(r.first_nul_runs.length,32);assert.equal(r.nul_runs_list_truncated,true);assert.equal(r.section_candidates[0].status,'INTERRUPTED_BY_NUL');});
});
