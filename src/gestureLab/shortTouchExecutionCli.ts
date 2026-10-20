import 'dotenv/config';
import {mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {stdin,stdout} from 'node:process';
import {createInterface} from 'node:readline/promises';
import {InstagramDriver} from '../instagram/InstagramDriver.js';
import {nativeLabPort} from './runtime.js';
import {annotatedAnchorScreenshot} from './anchorScreenshot.js';
import {investigateShortTouch,shortTouchActions} from './shortTouchExecution.js';
const directory=resolve('artifacts',`gesture-short-touch-execution-${Date.now()}`),driver=new InstagramDriver();
await mkdir(directory,{recursive:true});
try{
 if(process.env.DRY_RUN!=='true')throw Error('Configure DRY_RUN=true.');
 if(!stdin.isTTY||!stdout.isTTY)throw Error('Use CMD interativo.');
 const text=process.env.GESTURE_STICKER_TEXT??'Veja',style=Number(process.env.GESTURE_STYLE_INDEX??0);
 if(text!=='Veja'||![0,1,2,3].includes(style))throw Error('Ensaio exclusivo para Veja; verifique texto/estilo declarados.');
 await driver.checkAppium();await driver.connect();const session=driver.getSession(),live=nativeLabPort(driver,directory);
 const terminal=createInterface({input:stdin,output:stdout}),keepAlive=setInterval(()=>{void session.getCurrentPackage().catch(()=>{});},15000);
 try{console.log(`Deixe somente Veja no estilo ${style}, tamanho menor do controle manual (aproximadamente251–265px). Solte Ctrl/mouse e aguarde os controles do Instagram. Até3 receitas de aumento; na primeira que funcionar, somente1 redução. Não faça gestos durante o teste.`);
  await terminal.question('Quando pronto, pressione Enter aqui: ');
 }finally{clearInterval(keepAlive);terminal.close();}
 const readStable=async()=>{
  let key:string|undefined;
  for(let i=0;i<10;i++){
   try{const current=await live.read(),next=JSON.stringify(current);if(next===key)return current;key=next;}
   catch(error){if(!(error instanceof Error)||!error.message.startsWith('Exige editor com exatamente um sticker'))throw error;key=undefined;}
   await session.pause(300);
  }
  throw Error('Editor/sticker não estabilizou. Nenhum gesto adicional.');
 };
 const report=await investigateShortTouch({read:readStable,capture:live.capture,
  mark:async(name,before,plan)=>{const viewport=await session.getWindowRect(),file=join(directory,`${name}-anchors.svg`);await writeFile(file,annotatedAnchorScreenshot(await readFile(join(directory,`${name}.png`)),before,plan,viewport));return file;},
  record:async value=>{console.log(JSON.stringify(value));await appendFile(join(directory,'attempts.jsonl'),JSON.stringify(value)+'\n');},
  pinch:async(plan,before,recipe)=>{
   if(JSON.stringify(await live.read())!==JSON.stringify(before))throw Error('Bounds/objeto mudaram antes do gesto.');
   try{await session.performActions(shortTouchActions(plan,recipe));}finally{await session.releaseActions();}
   await session.pause(1200);
  }});
 await writeFile(join(directory,'short-touch-execution-report.json'),JSON.stringify({...report,context:{style_index:style,instagram_version:process.env.GESTURE_INSTAGRAM_VERSION??null,text_semantically_verified:false}},null,2));
 console.table(report.attempts.map(a=>({recipe:a.recipe.id,direction:a.direction,before:a.before_width,after:a.after_width,delta:a.delta_width,drift:a.center_drift,success:a.success})));
 console.log(`SHORT_AUTOMATED_SUCCESS=${report.SHORT_AUTOMATED_SUCCESS}`);if(!report.SHORT_AUTOMATED_SUCCESS)process.exitCode=1;
}catch(error){console.error('[FAIL]',error);process.exitCode=1;await writeFile(join(directory,'error.json'),JSON.stringify({error:String(error),published:false}));
 try{await driver.getSession().saveScreenshot(join(directory,'error.png'));await writeFile(join(directory,'error.xml'),await driver.getSession().getPageSource());}catch{}
}finally{await driver.disconnect().catch(error=>{console.error(error);process.exitCode=1;});console.log(`[SAFE] Sem publicação / sem benchmark. Artefatos: ${directory}`);}
