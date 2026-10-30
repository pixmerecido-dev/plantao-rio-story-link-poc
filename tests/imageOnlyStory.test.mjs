import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {prepareImageOnly} from '../dist/instagram/imageOnlyStory.js';
import {validatePanelContentJob,validatePanelTestResult,panelContentMode} from '../dist/local/panelContentMode.js';
import {defaultSettings,validateSettings} from '../dist/admin/domain.js';
import {dashboardStickerPreview} from '../dist/admin/stickerPreview.js';
function fixture({stickers=false,finalState='STATE_EDITOR'}={}){let state='STATE_HOME';const calls=[];return {calls,port:{clearLinkEvidence(){calls.push('clear');},async normalizeHome(){calls.push('home');},async state(){return state;},async prepareNewImage(){calls.push('image');state=finalState;},async confirmNoStickers(){calls.push('empty');return !stickers;},async capture(){calls.push('capture');}}};}
test('image-only creates fresh image, validates empty editor and has no link or gesture stage',async()=>{
 const previous=process.env.DRY_RUN;process.env.DRY_RUN='true';
 try{const p=fixture(),r=await prepareImageOnly('job',p.port);assert.deepEqual(p.calls,['clear','home','image','empty','capture','empty']);assert.equal(r.content_mode,'IMAGE_ONLY');assert.equal(r.published,false);assert.equal(r.move_command_sent,false);assert.equal(r.resize_command_sent,false);assert.equal(r.url_verified,false);validatePanelTestResult(r,'job','layout',false);assert.throws(()=>validatePanelTestResult(r,'job','layout',true));assert.throws(()=>validatePanelTestResult(r,'other','layout',false));assert.throws(()=>validatePanelTestResult(r,'job','move',false));}
 finally{if(previous===undefined)delete process.env.DRY_RUN;else process.env.DRY_RUN=previous;}
});
test('stale sticker, incorrect editor or missing dry run cannot confirm image-only readiness',async()=>{
 const previous=process.env.DRY_RUN;process.env.DRY_RUN='true';
 try{for(const options of [{stickers:true},{finalState:'STATE_EDITOR_WITH_LINK'}]){const p=fixture(options);await assert.rejects(prepareImageOnly('job',p.port),/não confirmado/);assert.equal(p.calls.includes('capture'),false);}delete process.env.DRY_RUN;const p=fixture();await assert.rejects(prepareImageOnly('job',p.port),/DRY_RUN/);assert.equal(p.calls.length,0);}
 finally{if(previous===undefined)delete process.env.DRY_RUN;else process.env.DRY_RUN=previous;}
});
test('image-only validates actual media but does not require URL or CTA; ON retains validation',async()=>{
 const input={job_id:'image',media:resolve('assets/story-test.jpg'),story_url:'',sticker_text:''};
 const job=await validatePanelContentJob(input,false);assert.equal(job.media.type,'IMAGE');assert.equal(job.story_url,'');assert.equal(job.publish_instagram,false);await assert.rejects(validatePanelContentJob(input,true),/obrigatório/);await assert.rejects(validatePanelContentJob({...input,media:'/does-not-exist.jpg'},false),/MEDIA_NOT_FOUND/);
});
test('OFF persists without truncating inactive link text, removes preview, ON restores strict text validation',()=>{
 const s=defaultSettings();const original=s.story.sticker.text;s.story.sticker.enabled=false;s.story.sticker.max_text_length=1;
 const saved=validateSettings(s);assert.equal(saved.story.sticker.text,original);assert.equal(saved.story.sticker.enabled,false);assert.equal(panelContentMode(false),'IMAGE_ONLY');assert.match(dashboardStickerPreview(saved),/display:none/);saved.story.sticker.enabled=true;assert.throws(()=>validateSettings(saved),/limite/);
});
test('image-only result cannot masquerade as linked success or omit negative evidence',()=>{
 const base={job_id:'j',published:false,layout_confirmed:true,content_mode:'IMAGE_ONLY',image_loaded:true,editor_final_confirmed:true,no_stickers_confirmed:true,link_steps_skipped:true,sticker_added:false,url_verified:false,sticker_text_verified:false,move_command_sent:false,resize_command_sent:false};
 for(const field of ['no_stickers_confirmed','link_steps_skipped','image_loaded','editor_final_confirmed'])assert.throws(()=>validatePanelTestResult({...base,[field]:false},'j','layout',false));
 for(const field of ['sticker_added','url_verified','move_command_sent','resize_command_sent','published'])assert.throws(()=>validatePanelTestResult({...base,[field]:true},'j','layout',false));
});
