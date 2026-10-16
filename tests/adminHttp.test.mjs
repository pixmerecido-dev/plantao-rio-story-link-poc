import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { JsonStorage } from '../dist/admin/jsonStorage.js';
import { createAdminServer } from '../dist/admin/httpServer.js';
import { defaultSettings } from '../dist/admin/domain.js';
import { ArtifactImporter } from '../dist/admin/artifactImporter.js';
async function fixture(){
  const root=await mkdtemp('/tmp/admin-http-'),repository=new JsonStorage(join(root,'admin.json'));await repository.getSettings();
  const server=createAdminServer({ repository,root,clientPath:resolve('dist/admin/client.js'),previewPath:resolve('assets/story-test.jpg') });
  await new Promise(accept=>server.listen(0,'127.0.0.1',accept));
  const url=`http://127.0.0.1:${server.address().port}`;
  return { root,repository,url,close:async()=>{server.closeAllConnections();await new Promise(accept=>server.close(accept));} };
}
test('HTTP real serve shell, JS, preview e settings sem segredos nem endpoint de publicação',async()=>{
  const app=await fixture();try{
    assert.match(await(await fetch(app.url)).text(),/Configuração do Story/);
    assert.equal((await fetch(`${app.url}/assets/client.js`)).status,200);
    assert.equal((await fetch(`${app.url}/api/preview`)).headers.get('content-type'),'image/jpeg');
    const settings=await(await fetch(`${app.url}/api/settings`)).json();assert.deepEqual(settings,defaultSettings());
    const dashboard=await(await fetch(`${app.url}/api/dashboard`)).json();assert.equal(dashboard.stats.success,0);assert.equal(dashboard.recent.length,0);
    assert.equal((await fetch(`${app.url}/api/publish`,{ method:'POST',headers:{ 'Content-Type':'application/json','X-Admin-Request':'local' },body:'{}' })).status,404);
    assert.equal((await fetch(`${app.url}/.env`)).status,404);
    const changed=defaultSettings();changed.story.sticker.text='<script>teste</script>';changed.secret='não expor';
    const saved=await fetch(`${app.url}/api/settings`,{ method:'PUT',headers:{ 'Content-Type':'application/json','X-Admin-Request':'local' },body:JSON.stringify(changed) });assert.equal(saved.status,200);
    assert.equal((await saved.json()).secret,undefined);
    assert.equal((await(new JsonStorage(join(app.root,'admin.json'))).getSettings()).story.sticker.text,'<script>teste</script>');
  }finally{await app.close();}
});
test('HTTP valida origem, tamanho, payload e mantém segurança ativada',async()=>{
  const app=await fixture();try{
    assert.equal((await fetch(`${app.url}/api/settings`,{ method:'PUT',headers:{ 'Content-Type':'application/json',Origin:'https://example.org','X-Admin-Request':'local' },body:'{}' })).status,403);
    assert.equal((await fetch(`${app.url}/api/settings`,{ method:'PUT',headers:{ 'Content-Type':'application/json' },body:'{}' })).status,415);
    const settings=defaultSettings();settings.safety.require_layout_confirmation=false;
    assert.equal((await fetch(`${app.url}/api/settings`,{ method:'PUT',headers:{ 'Content-Type':'application/json','X-Admin-Request':'local' },body:JSON.stringify(settings) })).status,400);
    assert.equal((await fetch(`${app.url}/api/publications?page=-1`)).status,400);
  }finally{await app.close();}
});
test('resumo real no formato do motor é importado uma vez sem inventar eventos intermediários',async()=>{
  const app=await fixture();try{
    const folder=join(app.root,'artifacts','story-end-to-end-real-1770000000000');await mkdir(folder,{ recursive:true });
    await writeFile(join(folder,'summary.json'),JSON.stringify({ job_id:'test-artifact-job',prepared:{ media:{ path:resolve('assets/story-test.jpg'),type:'IMAGE',filename:'story-test.jpg' },story_url:'https://example.org/materia',sticker_text:'Leia a matéria completa',layout_confirmed:true,layout:{ width:529,target:{ x:347.5,y:1138 } } },publication:{ outcome:'SUCCESS',clickCount:1,facebook_crosspost_enabled:true } }));
    const importer=new ArtifactImporter(app.repository,join(app.root,'artifacts'));
    assert.equal((await importer.sync()).imported,1);assert.equal((await importer.sync()).imported,0);
    const jobs=await app.repository.listJobs();assert.equal(jobs.length,1);assert.equal(jobs[0].status,'SUCCESS');assert.equal(jobs[0].published_at,null);assert.equal(jobs[0].facebook_crosspost,true);
    const events=await app.repository.listEvents();assert.equal(events.length,1);assert.equal(events[0].event,'ARTIFACT_IMPORTED');
    const detail=await(await fetch(`${app.url}/api/publications/${jobs[0].id}`)).json();assert.equal(detail.job.job_id,'test-artifact-job');
    assert.equal((await fetch(`${app.url}/api/publications/${jobs[0].id}/media`)).headers.get('content-type'),'image/jpeg');
  }finally{await app.close();}
});

test('preview padrão serve foto local de demonstração sem confundir com mídia de smoke', async () => {
  const root = resolve('.');
  const repository = new JsonStorage(join(await mkdtemp('/tmp/preview-demo-'), 'admin.json'));
  const server = createAdminServer({ repository, root });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/preview`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, await readFile(resolve('assets/story-preview-demo.jpg')));
    assert.notDeepEqual(bytes, await readFile(resolve('assets/story-test.jpg')));
  } finally {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
});

test('settings API persists scoped minimum and serves browser calibration module',async()=>{
 const app=await fixture();try{
  const limits=await(await fetch(`${app.url}/api/sticker-size-limits`)).json();
  assert.equal(limits[0].observed_min_width,504);assert.equal(limits[0].reference_initial_width,727);
  const module=await fetch(`${app.url}/assets/stickerSizeLimit.js`);
  assert.equal(module.status,200);assert.match(await module.text(),/minimumScale/);
  const settings=defaultSettings();settings.story.sticker.scale=0.6;
  const response=await fetch(`${app.url}/api/settings`,{method:'PUT',headers:{'Content-Type':'application/json','X-Admin-Request':'local'},body:JSON.stringify(settings)});
  assert.equal(response.status,200);assert.equal((await response.json()).story.sticker.scale,504/727);
  assert.equal((await(await fetch(`${app.url}/api/settings`)).json()).story.sticker.scale,504/727);
  const disk=JSON.parse(await readFile(join(app.root,'data/admin/sticker-size-limits.json'),'utf8'));
  assert.equal(disk.limits[0].scope.text,'Leia a matéria completa');
 }finally{await app.close();}
});
