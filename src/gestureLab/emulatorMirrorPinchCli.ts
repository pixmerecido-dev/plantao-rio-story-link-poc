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
import {testEmulatorMirrorPinch,emulatorMirrorActions} from './emulatorMirrorPinch.js';
const driver=new InstagramDriver(),directory=resolve('artifacts',`gesture-short-emulator-pinch-${Date.now()}`);
let logCapture:Awaited<ReturnType<typeof startTouchLog>>|undefined;
await mkdir(directory,{recursive:true});
try{
 if(process.env.DRY_RUN!=='true')throw Error('Configure DRY_RUN=true.');
 if((process.env.GESTURE_STICKER_TEXT??'Veja')!=='Veja'||Number(process.env.GESTURE_STYLE_INDEX??0)!==0)throw Error('Teste exclusivo de Veja branco/azul, estilo declarado0.');
 if(!stdin.isTTY||!stdout.isTTY)throw Error('Use CMD interativo.');
 await driver.checkAppium();await driver.connect();const session=driver.getSession(),live=nativeLabPort(driver,directory);
 const terminal=createInterface({input:stdin,output:stdout}),keepAlive=setInterval(()=>{void session.getCurrentPackage().catch(()=>{});},15000);
 try{console.log('Deixe somente Veja branco/azul, pequeno, na região central do Story, com espaço para crescer. Solte Ctrl/mouse e aguarde os botões. Será enviado UM aumento; depois não toque até terminar.');await terminal.question('Quando pronto, pressione Enter aqui: ');}finally{clearInterval(keepAlive);terminal.close();}
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
 logCapture=await startTouchLog(connectedAndroidDevice(session));
 const result=await testEmulatorMirrorPinch({read:readStable,
  capture:async name=>{
   await live.capture(name);const png=await readFile(join(directory,`${name}.png`));
   if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==viewport.width||png.readUInt32BE(20)!==viewport.height||viewport.x!==0||viewport.y!==0)throw Error('Viewport e screenshot não coincidem; não extrapolar coordenadas.');
  },
  record:async value=>{console.log(JSON.stringify(value));await appendFile(join(directory,'attempts.jsonl'),JSON.stringify(value)+'\n');},
  pinch:async(plan,before)=>{
   if(JSON.stringify(await live.read())!==JSON.stringify(before))throw Error('Objeto/bounds mudaram antes do gesto.');
   if(JSON.stringify(await session.getWindowRect())!==JSON.stringify(viewport))throw Error('Viewport mudou antes do gesto.');
   try{await session.performActions(emulatorMirrorActions(plan));}finally{await session.releaseActions();}
   await session.pause(1200);
  }},viewport);
 const log=await logCapture.stop();logCapture=undefined;const logFile=join(directory,'touch-injection-logcat.txt');await writeFile(logFile,log.text);
 const evidence=analyzeTouchInjectionLog(log.text),success=result.measured_resize_success&&evidence.injection_sequence_observed&&!log.truncated;
 await writeFile(join(directory,'short-emulator-pinch-report.json'),JSON.stringify({...result,success,touch_injection:{...evidence,truncated:log.truncated,stderr:log.stderr,log_file:logFile},context:{text_declared_by_operator:'Veja',style_index:0,text_semantically_verified:false,instagram_version:process.env.GESTURE_INSTAGRAM_VERSION??null}},null,2));
 console.table([{before:result.before_width,after:result.after_width,delta:result.delta_width,drift:result.center_drift,injection:evidence.injection_sequence_observed,success}]);
 if(!success)process.exitCode=1;
}catch(error){console.error('[FAIL]',error);process.exitCode=1;await writeFile(join(directory,'error.json'),JSON.stringify({error:String(error),published:false}));
 try{await driver.getSession().saveScreenshot(join(directory,'error.png'));await writeFile(join(directory,'error.xml'),await driver.getSession().getPageSource());}catch{}
}finally{if(logCapture){const log=await logCapture.stop().catch(()=>null);if(log)await writeFile(join(directory,'touch-injection-logcat.txt'),log.text);}await driver.disconnect().catch(error=>{console.error(error);process.exitCode=1;});console.log(`[SAFE] Sem publicação / sem benchmark. Artefatos: ${directory}`);}
