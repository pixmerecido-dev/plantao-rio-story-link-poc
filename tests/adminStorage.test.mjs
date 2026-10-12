import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonStorage } from '../dist/admin/jsonStorage.js';
import { StorySettingsService } from '../dist/admin/storySettingsService.js';
import { defaultSettings,REFERENCE } from '../dist/admin/domain.js';
import { publicationStats,PublicationsService } from '../dist/admin/publicationsService.js';
function job(id='test-job',overrides={}){return { id,job_id:id,created_at:'2026-10-12T12:00:00Z',started_at:'2026-10-12T12:00:01Z',finished_at:'2026-10-12T12:02:00Z',published_at:'2026-10-12T12:01:50Z',media_path:null,media_type:'IMAGE',media_filename:null,story_url:'https://example.org/test',sticker_text:'Texto de teste',sticker_scale:.76,sticker_x:347.5,sticker_y:1138,instagram_status:'SUCCESS',facebook_crosspost:null,status:'SUCCESS',attempts:1,duration_ms:119000,error_code:null,error_message:null,...overrides };}
test('defaults derivam do canvas REAL aprovado, não do exemplo 47.4%',()=>{
  const settings=defaultSettings();assert.equal(settings.story.sticker.x_pct,347.5/1080);assert.equal(settings.story.sticker.y_pct,1138/1920);assert.equal(settings.story.sticker.scale,529/696);assert.equal(REFERENCE.height,1920);
});
test('settings sobrevivem reinício e serviço fornece interface para motor futuro',async()=>{
  const filename=join(await mkdtemp('/tmp/admin-store-'),'admin.json'),storage=new JsonStorage(filename),service=new StorySettingsService(storage);
  const settings=await service.getSettings();settings.story.sticker.text='Saiba mais';settings.story.sticker.scale=.8;settings.story.sticker.x_pct=.4;
  await service.save(settings);
  const reopened=new StorySettingsService(new JsonStorage(filename));assert.equal(await reopened.getStickerText(),'Saiba mais');assert.equal(await reopened.getStickerScale(),.8);assert.deepEqual(await reopened.getStickerPosition(),{ x_pct:.4,y_pct:1138/1920 });assert.deepEqual(await reopened.getPublishingSettings(),{ instagram_enabled:true,facebook_enabled:true });
  await reopened.restoreDefaults();assert.deepEqual(await reopened.getSettings(),defaultSettings());
});
test('validação rejeita escala, posição, texto e segurança inválidos sem gravar',async()=>{
  const file=join(await mkdtemp('/tmp/admin-validation-'),'admin.json'),service=new StorySettingsService(new JsonStorage(file));
  for(const change of [s=>s.story.sticker.scale=3,s=>s.story.sticker.x_pct=NaN,s=>s.story.sticker.text=' ',s=>s.story.sticker.min_scale=1.1,s=>s.safety.require_link_confirmation=false]){
    const settings=defaultSettings();change(settings);await assert.rejects(service.save(settings));
  }
  assert.deepEqual(await service.getSettings(),defaultSettings());
});
test('escritas concorrentes não perdem jobs/eventos e dados extras não entram no histórico',async()=>{
  const file=join(await mkdtemp('/tmp/admin-concurrency-'),'admin.json'),storage=new JsonStorage(file),service=new PublicationsService(storage);
  await Promise.all(Array.from({ length:12 },(_,index)=>service.record({ ...job(`test-${index}`),password:'não persistir' })));
  await service.recordEvent('test-0','LAYOUT_CONFIRMED','Evento de teste',{ test:true });
  const reopened=new JsonStorage(file);assert.equal((await reopened.listJobs()).length,12);assert.equal((await reopened.listEvents('test-0')).length,1);assert.equal((await readFile(file,'utf8')).includes('não persistir'),false);
});
test('armazenamento corrompido não é substituído silenciosamente',async()=>{
  const file=join(await mkdtemp('/tmp/admin-corrupt-'),'admin.json');await writeFile(file,'invalid json');
  await assert.rejects(new JsonStorage(file).getSettings(),/arquivo preservado/);assert.equal(await readFile(file,'utf8'),'invalid json');
});
test('dashboard vazio não fabrica publicações ou média de horário',()=>{
  const result=publicationStats([],new Date('2026-10-12T15:00:00Z'));assert.equal(result.today,0);assert.equal(result.successRate,null);assert.equal(result.lastPublication,null);assert.equal(result.averageTime,null);
});
test('estatísticas respeitam Brasília, períodos móveis e média circular',()=>{
  const jobs=[job('midnight',{ published_at:'2026-10-12T02:00:00Z' }),job('one',{ published_at:'2026-10-12T04:00:00Z' }),job('failed',{ status:'FAILED',published_at:null }),job('unclear',{ status:'INCONCLUSIVE',published_at:null })];
  const result=publicationStats(jobs,new Date('2026-10-12T10:00:00Z'));assert.equal(result.today,1);assert.equal(result.last24h,2);assert.equal(result.success,2);assert.equal(result.failed,1);assert.equal(result.successRate,50);assert.equal(result.averageTime,'00:00');
});
test('publicações usam filtros e paginação sem misturar status de sucesso',async()=>{
  const storage=new JsonStorage(join(await mkdtemp('/tmp/admin-filters-'),'admin.json')),service=new PublicationsService(storage);
  await service.record(job('real-test'));await service.record(job('failed-test',{ status:'FAILED',media_type:'VIDEO',sticker_text:'Outro' }));
  assert.equal((await service.list({ status:'FAILED',type:'VIDEO',search:'Outro' })).total,1);assert.equal((await service.detail('real-test')).job.job_id,'real-test');assert.equal(await service.detail('missing'),undefined);
});
