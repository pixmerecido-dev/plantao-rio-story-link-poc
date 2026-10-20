import 'dotenv/config';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {InstagramDriver} from '../instagram/InstagramDriver.js';
import {nativeLabPort} from './runtime.js';
import {measureManualRange,type ManualRangeStage} from './manualRange.js';
const directory=resolve('artifacts',`gesture-anchor-manual-range-${Date.now()}`),driver=new InstagramDriver();
await mkdir(directory,{recursive:true});
try{
 if(process.env.DRY_RUN!=='true')throw Error('Configure DRY_RUN=true.');
 if(!stdin.isTTY||!stdout.isTTY)throw Error('Teste manual exige CMD interativo.');
 const text=process.env.GESTURE_STICKER_TEXT??'Veja',style=Number(process.env.GESTURE_STYLE_INDEX??0);
 if(!text.trim()||![0,1,2,3].includes(style))throw Error('Texto/estilo inválidos.');
 await driver.checkAppium();await driver.connect();const session=driver.getSession(),live=nativeLabPort(driver,directory);
 const terminal=createInterface({input:stdin,output:stdout}),keepAlive=setInterval(()=>{void session.getCurrentPackage().catch(()=>{});},15000);
 const stages:unknown[]=[];
 const instructions:Record<ManualRangeStage,string>={initial:`Deixe um único sticker "${text}" no estado inicial desejado.`,maximum:'Aumente manualmente com Ctrl + mouse até o máximo que conseguir.',minimum:'Diminua manualmente com Ctrl + mouse até o mínimo que conseguir.'};
 const readStable=async()=>{
  let previous:string|undefined;
  for(let i=0;i<10;i++){
   try{
    const snapshot=await live.read(),key=JSON.stringify(snapshot);
    if(key===previous)return snapshot;previous=key;
   }catch(error){
    if(!(error instanceof Error)||!error.message.startsWith('Exige editor com exatamente um sticker'))throw error;
    previous=undefined;
   }
   await session.pause(300);
  }
  throw Error('Editor não estabilizou. Solte Ctrl/mouse e aguarde os botões reaparecerem antes de Enter.');
 };
 try{
  const report=await measureManualRange({
   waitForEnter:async stage=>{
    console.log(`\n${stage.toUpperCase()}: ${instructions[stage]} Solte Ctrl e o botão do mouse e aguarde os botões do Instagram reaparecerem.`);
    await terminal.question('Só então pressione Enter neste CMD para registrar: ');
   },
   read:readStable,
   capture:async stage=>{await live.capture(`manual-${stage}`);return join(directory,`manual-${stage}.png`);},
   record:async entry=>{
    stages.push(entry);await writeFile(join(directory,'manual-range-progress.json'),JSON.stringify({context:{text_declared_by_operator:text,style_index:style},stages,complete:false,automated_touch_sent:false,published:false},null,2));
    console.log('MEDIDA',JSON.stringify(entry));
   },
  });
  const result={...report,context:{text_declared_by_operator:text,style_index:style,instagram_version:process.env.GESTURE_INSTAGRAM_VERSION??null,text_semantically_verified:false}};
  await writeFile(join(directory,'anchor-manual-range-report.json'),JSON.stringify(result,null,2));
  console.table(report.stages.map(s=>({stage:s.stage,width:s.width,height:s.height,bounds:JSON.stringify(s.snapshot.bounds)})));
  console.log(`MANUAL_RANGE_SUCCESS=${report.success}`);if(!report.success)process.exitCode=1;
 }finally{clearInterval(keepAlive);terminal.close();}
}catch(error){console.error('[FAIL]',error);process.exitCode=1;await writeFile(join(directory,'error.json'),JSON.stringify({error:String(error),published:false}));
 try{await driver.getSession().saveScreenshot(join(directory,'error.png'));await writeFile(join(directory,'error.xml'),await driver.getSession().getPageSource());}catch{}
}finally{await driver.disconnect().catch(error=>{console.error(error);process.exitCode=1;});console.log(`[SAFE] Sem gestos automáticos / sem publicação. Artefatos: ${directory}`);}
