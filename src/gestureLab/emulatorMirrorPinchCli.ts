import 'dotenv/config';
import {mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {stdin,stdout} from 'node:process';
import {createInterface} from 'node:readline/promises';
import {InstagramDriver} from '../instagram/InstagramDriver.js';
import {nativeLabPort} from './runtime.js';
import {connectedAndroidDevice} from '../instagram/addStoryAndroidDiagnostics.js';
import {startTouchLog} from './touchLogCapture.js';
import {analyzeTouchInjectionLog} from './touchInjectionLog.js';
import {benchmarkMirrorPrecision,type MirrorPrecisionText} from './emulatorMirrorPrecision.js';
import {ObservedSizeLimitStore} from './sizeLimitStore.js';
import {findObservedLimit} from '../admin/stickerSizeLimit.js';
import {repeatEmulatorMirrorCycles} from './emulatorMirrorCycles.js';
import {testEmulatorMirrorPinch,emulatorMirrorActions} from './emulatorMirrorPinch.js';
const cycles=process.argv[2]==='cycles',precision=process.argv[2]==='precision';
const text=process.env.GESTURE_STICKER_TEXT??'Veja';
const textPrecision=precision&&text!=='Veja',reportName=textPrecision?'text-emulator-precision-report.json':'short-emulator-precision-report.json';
const direction=process.argv[2]==='in'?'in':'out';
const driver=new InstagramDriver(),directory=resolve('artifacts',`gesture-${textPrecision?'text':'short'}-emulator-pinch${precision?'-precision':cycles?'-cycles':direction==='in'?'-in':''}-${Date.now()}`);
let activePrefix='';
let logCapture:Awaited<ReturnType<typeof startTouchLog>>|undefined;
await mkdir(directory,{recursive:true});
try{
 if(process.env.DRY_RUN!=='true')throw Error('Configure DRY_RUN=true.');
 if((precision?!['Veja','Leia a matéria completa','veja a materia complata no jornal'].includes(text):text!=='Veja')||Number(process.env.GESTURE_STYLE_INDEX??0)!==0)throw Error('Use um texto previsto neste ensaio, branco/azul, estilo declarado 0.');
 if(!stdin.isTTY||!stdout.isTTY)throw Error('Use CMD interativo.');
 await driver.checkAppium();await driver.connect();const session=driver.getSession(),live=nativeLabPort(driver,directory);
 const terminal=createInterface({input:stdin,output:stdout}),keepAlive=setInterval(()=>{void session.getCurrentPackage().catch(()=>{});},15000);
 try{console.log(precision?`Mantenha somente “${text}” branco/azul e central, com espaço para crescer. Solte Ctrl/mouse e aguarde os botões. Serão5 alvos alternados +10%/-10%, tolerância4%; não toque até terminar.`:cycles?'Mantenha somente Veja branco/azul, pequeno e central, no estado deixado pela redução aprovada. Solte Ctrl/mouse e aguarde os botões. Serão até5 ciclos automáticos de aumento/redução; não toque até terminar.':direction==='in'?'Mantenha Veja branco/azul no tamanho deixado pelo aumento aprovado, na região central do Story. Não diminua manualmente. Solte Ctrl/mouse e aguarde os botões. Será enviada UMA redução; depois não toque até terminar.':'Deixe somente Veja branco/azul, pequeno, na região central do Story, com espaço para crescer. Solte Ctrl/mouse e aguarde os botões. Será enviado UM aumento; depois não toque até terminar.');await terminal.question('Quando pronto, pressione Enter aqui: ');}finally{clearInterval(keepAlive);terminal.close();}
 const viewport=await session.getWindowRect();
 const readStable=async()=>{
  let previous:string|undefined;
  for(let i=0;i<10;i++){
   try{const s=await live.read(),key=JSON.stringify(s);if(key===previous)return s;previous=key;}
   catch(error){if(!(error instanceof Error)||!error.message.startsWith('Exige editor com exatamente um sticker'))throw error;previous=undefined;}
   await session.pause(300);
  }
  throw Error('Editor/sticker não estabilizou.');
 };
 const run=async(direction:'in'|'out',cycle=0,expected?:Awaited<ReturnType<typeof live.read>>)=>{
 activePrefix=precision?`round-${Math.floor(cycle/10)}-attempt-${cycle%10}-${direction}-`:cycle?`cycle-${cycle}-${direction}-`:'';
 if(expected&&JSON.stringify(await readStable())!==JSON.stringify(expected))throw Error('Estado mudou entre gestos; ciclo interrompido antes de novo toque.');
 logCapture=await startTouchLog(connectedAndroidDevice(session));
 const result=await testEmulatorMirrorPinch({read:readStable,
  capture:async name=>{
   const artifact=`${activePrefix}${name}`;await live.capture(artifact);const png=await readFile(join(directory,`${artifact}.png`));
   if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==viewport.width||png.readUInt32BE(20)!==viewport.height||viewport.x!==0||viewport.y!==0)throw Error('Viewport e screenshot não coincidem; não extrapolar coordenadas.');
  },
  record:async value=>{console.log(JSON.stringify(value));await appendFile(join(directory,'attempts.jsonl'),JSON.stringify({cycle,...value})+'\n');},
  pinch:async(plan,before)=>{
   if(JSON.stringify(await live.read())!==JSON.stringify(before))throw Error('Objeto/bounds mudaram antes do gesto.');
   if(JSON.stringify(await session.getWindowRect())!==JSON.stringify(viewport))throw Error('Viewport mudou antes do gesto.');
   try{await session.performActions(emulatorMirrorActions(plan));}finally{await session.releaseActions();}
   await session.pause(1200);
  }},viewport,direction);
 const log=await logCapture.stop();logCapture=undefined;const logFile=join(directory,`${activePrefix}touch-injection-logcat.txt`);await writeFile(logFile,log.text);
 const evidence=analyzeTouchInjectionLog(log.text),success=result.measured_resize_success&&evidence.injection_sequence_observed&&!log.truncated;
 const report={...result,success,touch_injection:{...evidence,truncated:log.truncated,stderr:log.stderr,log_file:logFile},context:{text_declared_by_operator:text,style_index:0,text_semantically_verified:false,instagram_version:process.env.GESTURE_INSTAGRAM_VERSION??null}};
 await writeFile(join(directory,`${activePrefix}${direction==='in'?'short-emulator-pinch-in-report.json':'short-emulator-pinch-report.json'}`),JSON.stringify(report,null,2));
 console.table([{before:result.before_width,after:result.after_width,delta:result.delta_width,drift:result.center_drift,injection:evidence.injection_sequence_observed,success}]);
 return report;
 };
 if(precision){
  const initial=await readStable(),scope={text,style_index:0,canvas_width:initial.canvas.right-initial.canvas.left,canvas_height:initial.canvas.bottom-initial.canvas.top,device:initial.device,instagram_version:process.env.GESTURE_INSTAGRAM_VERSION??null};
  const limits=await new ObservedSizeLimitStore(resolve(process.env.ADMIN_DATA_DIR??'data/admin','sticker-size-limits.json')).load(),limit=findObservedLimit(limits,scope);
  const report=await benchmarkMirrorPrecision(readStable,run,limit,async report=>{await writeFile(join(directory,reportName),JSON.stringify(report,null,2));},text as MirrorPrecisionText);
  console.table(report.rounds.map(r=>({round:r.round,scale:r.requested_scale,before:r.initial_width,target:r.effective_target_width,final:r.final_width,error_percent:r.error_percent,clamped:r.clamped,success:r.success})));
  console.log(`PRECISION_QUALIFIED=${report.qualified}`);if(!report.qualified)process.exitCode=1;
 }else if(cycles){
  const report=await repeatEmulatorMirrorCycles(run,async report=>{await writeFile(join(directory,'short-emulator-cycles-report.json'),JSON.stringify(report,null,2));});
  console.table(report.rounds.map(r=>({cycle:r.cycle,before:r.increase.before_width,increased:r.increase.after_width,reduced:r.decrease?.after_width,success:r.success})));
  console.log(`CYCLES_QUALIFIED=${report.qualified}`);if(!report.qualified)process.exitCode=1;
 }else{const report=await run(direction);if(!report.success)process.exitCode=1;}
}catch(error){console.error('[FAIL]',error);process.exitCode=1;await writeFile(join(directory,'error.json'),JSON.stringify({error:String(error),published:false}));
 try{await driver.getSession().saveScreenshot(join(directory,'error.png'));await writeFile(join(directory,'error.xml'),await driver.getSession().getPageSource());}catch{}
}finally{if(logCapture){const log=await logCapture.stop().catch(()=>null);if(log)await writeFile(join(directory,`${activePrefix}touch-injection-logcat.txt`),log.text);}await driver.disconnect().catch(error=>{console.error(error);process.exitCode=1;});console.log(`[SAFE] Sem publicação / sem integração ao painel. Artefatos: ${directory}`);}
