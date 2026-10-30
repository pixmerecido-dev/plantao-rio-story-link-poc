import 'dotenv/config';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {stdin,stdout} from 'node:process';
import {createInterface} from 'node:readline/promises';
import {InstagramDriver} from '../instagram/InstagramDriver.js';
import {nativeLabPort} from './runtime.js';
import {connectedAndroidDevice} from '../instagram/addStoryAndroidDiagnostics.js';
import {startTouchLog} from './touchLogCapture.js';
import {runDiagnostic575} from './diagnostic575.js';
import {loadDiagnostic575History} from './diagnostic575History.js';
import {diagnosticImageDiff} from './diagnosticImageDiff.js';
import {center,width} from './core.js';
const directory=resolve('artifacts',`gesture-575-diagnostic-${Date.now()}`),driver=new InstagramDriver();
let log:Awaited<ReturnType<typeof startTouchLog>>|undefined;
await mkdir(directory,{recursive:true});
const escape=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
try{
 if(process.env.DRY_RUN!=='true')throw Error('Configure DRY_RUN=true.');
 if(process.env.GESTURE_STICKER_TEXT!=='Leia a matéria completa'||Number(process.env.GESTURE_STYLE_INDEX??0)!==0)throw Error('Diagnóstico exclusivo do texto padrão branco/azul, estilo declarado 0.');
 if(!stdin.isTTY||!stdout.isTTY)throw Error('Use CMD interativo.');
 const references=await loadDiagnostic575History(resolve('artifacts'),{approved:process.env.GESTURE_575_APPROVED_REPORT,stalled:process.env.GESTURE_575_STALLED_REPORT});
 const historicalScreens:Record<string,unknown>={};
 for(const label of ['approved','stalled'] as const){
  historicalScreens[label]={};
  for(const stage of ['before','after'] as const){
   const source=references[label].screenshot_sources?.[stage],name=`historical-${label}-${stage}.png`;
   let copied=false;if(source)try{await copyFile(source,join(directory,name));copied=true;}catch{}
   (historicalScreens[label] as Record<string,unknown>)[stage]={file:copied?name:null,status:copied?'COPIED':'UNAVAILABLE',source:source??null};
  }
 }
 await driver.checkAppium();await driver.connect();const session=driver.getSession(),live=nativeLabPort(driver,directory);
 const terminal=createInterface({input:stdin,output:stdout}),keepAlive=setInterval(()=>{void session.getCurrentPackage().catch(()=>{});},15000);
 try{
  console.log('Deixe somente Leia a matéria completa branco/azul no estado de 575 px. Não altere estilo/texto. A será reutilizada do relatório antigo, sem gesto. B/C mudam contato, D encurta a trajetória e E dobra a duração. Uma tentativa por variante; para na primeira redução ou evidência que exija revisão. Sem benchmark, MOVE ou publicação.');
  await terminal.question('Solte Ctrl/mouse, aguarde os botões do Instagram e pressione Enter neste CMD: ');
 }finally{clearInterval(keepAlive);terminal.close();}
 const viewport=await session.getWindowRect(),device=connectedAndroidDevice(session);
 const readStable=async()=>{
  let previous:string|undefined;
  for(let i=0;i<10;i++){
   try{const s=await live.read(),key=JSON.stringify(s);if(key===previous)return s;previous=key;}
   catch(error){if(!(error instanceof Error)||!error.message.startsWith('Exige editor com exatamente um sticker'))throw error;previous=undefined;}
   await session.pause(300);
  }
  throw Error('Editor não estabilizou.');
 };
 const initial=await readStable();
 if(viewport.x!==0||viewport.y!==0||viewport.width!==1080||viewport.height!==2400||initial.canvas.left!==0||initial.canvas.top!==0||width(initial.canvas)!==1080||initial.canvas.bottom!==1920||device!=='emulator-5554')throw Error('Ambiente fora da configuração validada; nenhum gesto enviado.');
 const capture=async(name:string)=>{
  await live.capture(name);const png=await readFile(join(directory,`${name}.png`));
  if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==viewport.width||png.readUInt32BE(20)!==viewport.height)throw Error('Screenshot/viewport divergentes.');
  return png;
 };
 const progress=async(report:Awaited<ReturnType<typeof runDiagnostic575>>)=>{
  const comparison={...report,context:{text_declared_by_operator:process.env.GESTURE_STICKER_TEXT,style_index:0,instagram_version:process.env.GESTURE_INSTAGRAM_VERSION??null,text_semantically_verified:false},
   references,historical_screenshots:historicalScreens,
   approved_vs_current:report.attempts.map(a=>({variant:a.variant,approved:references.approved.geometry,current:a.geometry})),
   evidence_limits:['XML bounds do not reveal Instagram hit regions.','Driver accepted events do not prove Instagram received or recognized pinch.','Pixel changes can include background or rotation; review screenshots.','Manual minimum 575 was reported previously; this diagnostic does not update any limit.']};
  await writeFile(join(directory,'gesture-575-diagnostic-report.json'),JSON.stringify(comparison,null,2));
  const columns=[{name:'Aprovado histórico',geometry:references.approved.geometry},{name:'Travado histórico / A sem novo gesto',geometry:references.stalled.geometry},...report.attempts.map(a=>({name:`Variante ${a.variant}`,geometry:{...a.geometry,after_bounds:a.after.bounds,after_width:width(a.after.bounds),after_height:a.after.bounds.bottom-a.after.bounds.top,after_center:center(a.after.bounds)}}))];
  const keys=['bounds','width','height','center','anchors','distance_factor','finger1_start','finger1_end','finger2_start','finger2_end','initial_distance_between_fingers','final_distance_between_fingers','duration_ms','steps','after_bounds','after_width','after_height','after_center'] as const;
  const table=`<table><thead><tr><th>Medida</th>${columns.map(c=>`<th>${escape(c.name)}</th>`).join('')}</tr></thead><tbody>${keys.map(k=>`<tr><th>${escape(k)}</th>${columns.map(c=>`<td><pre>${escape(JSON.stringify(c.geometry[k]))}</pre></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const images=[...['approved','stalled'].flatMap(label=>['before','after'].map(stage=>({name:`${label} ${stage}`,file:((historicalScreens[label] as Record<string,{file:string|null}>)[stage]!).file}))),...report.attempts.flatMap(a=>['before','after'].map(stage=>({name:`${a.variant} ${stage}`,file:`${a.variant}-${stage}.png`})))];
  await writeFile(join(directory,'comparison.html'),`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Diagnóstico 575 px</title><style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px;vertical-align:top}pre{white-space:pre-wrap}figure{display:inline-block}img{max-width:260px}</style><h1>Diagnóstico isolado de 575 px</h1><p>${escape(report.stop_reason)} — causa comprovada: não. Área interativa real: desconhecida. Capturas podem conter diferenças de fundo.</p>${table}${images.filter(i=>i.file).map(i=>`<figure><figcaption>${escape(i.name)}</figcaption><img src="${escape(i.file)}" alt="${escape(i.name)}"></figure>`).join('')}</html>`);
 };
 const report=await runDiagnostic575({read:readStable,attempt:async(geometry,before)=>{
  const id=geometry.variant.id,baseline=await capture(`${id}-idle`);await session.pause(500);
  const pre=await capture(`${id}-before`);
  if(JSON.stringify(await readStable())!==JSON.stringify(before))throw Error('Bounds mudaram durante capturas; nenhum gesto enviado.');
  const p=geometry.plan,b=before.bounds;
  await writeFile(join(directory,`${id}-pointers.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="2400"><image width="1080" height="2400" href="data:image/png;base64,${pre.toString('base64')}"/><rect x="${b.left}" y="${b.top}" width="${width(b)}" height="${b.bottom-b.top}" fill="none" stroke="cyan"/>${[[p.finger1_start,p.finger1_end,'red'],[p.finger2_start,p.finger2_end,'lime']].map(([start,end,color])=>{const a=start as {x:number;y:number},z=end as {x:number;y:number};return `<line x1="${a.x}" y1="${a.y}" x2="${z.x}" y2="${z.y}" stroke="${color}" stroke-width="4"/><circle cx="${a.x}" cy="${a.y}" r="7" fill="${color}"/>`;}).join('')}</svg>`);
  const requestedAt=new Date().toISOString();let command_error:string|null=null;
  log=await startTouchLog(device);
  try{
   if(JSON.stringify(await readStable())!==JSON.stringify(before)||JSON.stringify(await session.getWindowRect())!==JSON.stringify(viewport))throw Error('Estado/viewport mudou antes do gesto.');
   try{await session.performActions(geometry.actions);}finally{await session.releaseActions();}
  }catch(error){command_error=String(error);}
  const commandCompletedAt=new Date().toISOString();await session.pause(1200);
  const captured=await log.stop();log=undefined;await writeFile(join(directory,`${id}-touch-injection-logcat.txt`),captured.text);
  const after=await readStable(),post=await capture(`${id}-after`);
  const roi={left:Math.min(before.bounds.left,after.bounds.left)-12,top:Math.min(before.bounds.top,after.bounds.top)-12,right:Math.max(before.bounds.right,after.bounds.right)+12,bottom:Math.max(before.bounds.bottom,after.bounds.bottom)+12};
  let visual:Record<string,unknown>;
  try{
   const idle=diagnosticImageDiff(baseline,pre,roi),change=diagnosticImageDiff(pre,post,roi),unchanged=JSON.stringify(before.bounds)===JSON.stringify(after.bounds);
   visual={idle_noise:idle,before_after:change,xml_bounds_unchanged:unchanged,visual_change_without_xml_change_candidate:unchanged&&change.changed_pixels>=20&&change.changed_ratio>Math.max(.005,idle.changed_ratio*3),app_hit_region_verified:false};
  }catch(error){visual={analysis_status:'UNAVAILABLE',error:String(error),visual_change_without_xml_change_candidate:false};}
  return {after,command_error,logcat:captured.text,log_truncated:captured.truncated,visual,
   artifacts:{before:`${id}-before.png`,after:`${id}-after.png`,idle:`${id}-idle.png`,overlay:`${id}-pointers.svg`,logcat:`${id}-touch-injection-logcat.txt`,requested_at:requestedAt,command_completed_at:commandCompletedAt,measured_at:new Date().toISOString(),log_stderr:captured.stderr}};
 }},viewport,progress);
 await progress(report);console.table(report.attempts.map(a=>({variant:a.variant,before:width(a.before.bounds),after:width(a.after.bounds),delta:a.delta_width,injection:a.touch_timeline.sequence_valid,success:a.success})));
 console.log(`PREFERRED_VARIANT=${report.preferred_variant??'NONE'}; STOP=${report.stop_reason}`);
}catch(error){console.error('[FAIL]',error);process.exitCode=1;await writeFile(join(directory,'error.json'),JSON.stringify({error:String(error),published:false}));
 try{await driver.getSession().saveScreenshot(join(directory,'error.png'));await writeFile(join(directory,'error.xml'),await driver.getSession().getPageSource());}catch{}
}finally{if(log){const captured=await log.stop().catch(()=>null);if(captured)await writeFile(join(directory,'interrupted-touch-injection-logcat.txt'),captured.text);}await driver.disconnect().catch(error=>{console.error(error);process.exitCode=1;});console.log(`[SAFE] Sem publicação / sem benchmark / sem alteração de limite. Artefatos: ${directory}`);}
