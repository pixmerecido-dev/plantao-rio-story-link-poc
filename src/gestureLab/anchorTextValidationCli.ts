import 'dotenv/config';
import {mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {InstagramDriver} from '../instagram/InstagramDriver.js';
import {nativeLabPort} from './runtime.js';
import {anchorActions,type AnchorPort} from './anchorCalibration.js';
import {annotatedAnchorScreenshot} from './anchorScreenshot.js';
import {validateAnchorTexts,STANDARD_ANCHOR_TEXT,validateCaseText} from './anchorTextValidation.js';
const directory=resolve('artifacts',`gesture-anchor-text-validation-${Date.now()}`),driver=new InstagramDriver();
await mkdir(directory,{recursive:true});
try{
 if(process.env.DRY_RUN!=='true')throw Error('Configure DRY_RUN=true.');
 if(!stdin.isTTY||!stdout.isTTY)throw Error('Este teste exige CMD interativo para preparar os três textos manualmente.');
 const style=Number(process.env.GESTURE_STYLE_INDEX??0);if(![0,1,2,3].includes(style))throw Error('Estilo inválido.');
 await driver.checkAppium();await driver.connect();const session=driver.getSession();
 const terminal=createInterface({input:stdin,output:stdout});
 const keepAlive=setInterval(()=>{void session.getCurrentPackage().catch(()=>{});},15000);
 try{
  const report=await validateAnchorTexts(async id=>{
   let text=id==='short'?'Veja':id==='standard'?STANDARD_ANCHOR_TEXT:'';
   if(id==='long'){
    console.log('Prepare um texto longo próximo do maior comprimento aceito visualmente pelo Instagram, sem truncamento. Não estamos medindo um limite universal.');
    text=(await terminal.question('Cole aqui o texto longo EXATO aceito no sticker: ')).trim();validateCaseText(id,text);
   }
   console.log(`CASO ${id}: deixe um único Link Sticker com o texto exato "${text}", estilo ${style}, já visível no editor. Aumente manualmente acima do mínimo desse texto para permitir redução. Não publique.`);
   await terminal.question('Quando o editor estiver pronto, pressione Enter neste CMD: ');
   // New visual identity guard for each manually prepared sticker; never carry the prior object's identity across texts.
   const live=nativeLabPort(driver,directory);
   const port:AnchorPort={read:live.read,capture:live.capture,
    mark:async(name,before,plan)=>{
     const viewport=await session.getWindowRect(),file=join(directory,`${name}-anchors.svg`);
     await writeFile(file,annotatedAnchorScreenshot(await readFile(join(directory,`${name}.png`)),before,plan,viewport));
     await writeFile(join(directory,`${name}-viewport.json`),JSON.stringify({viewport,annotation:'calculated, not detected contacts'},null,2));return file;
    },
    record:async value=>{console.log(JSON.stringify(value));await appendFile(join(directory,'attempts.jsonl'),JSON.stringify(value)+'\n');},
    pinch:async(plan,before)=>{
     if(JSON.stringify(await live.read())!==JSON.stringify(before))throw Error('Objeto/bounds mudaram antes do gesto.');
     try{await session.performActions(anchorActions(plan));}finally{await session.releaseActions();}
     await session.pause(1200);
    }};
   return {text,style_index:style,port};
  },async report=>{await writeFile(join(directory,'anchor-text-validation-report.json'),JSON.stringify({...report,instagram_version:process.env.GESTURE_INSTAGRAM_VERSION??null},null,2));});
  console.table(report.cases.map(c=>({text:c.text_declared_by_operator,bounds:JSON.stringify(c.initial.bounds),in_delta:c.pinch_in?.delta_width,in_drift:c.pinch_in?.center_drift,in_pass:c.pinch_in?.success,out_delta:c.pinch_out?.delta_width,out_drift:c.pinch_out?.center_drift,out_pass:c.pinch_out?.success})));
  console.log(`ANCHOR_GEOMETRY_QUALIFIED=${report.ANCHOR_GEOMETRY_QUALIFIED}`);
  if(!report.ANCHOR_GEOMETRY_QUALIFIED)process.exitCode=1;
 }finally{clearInterval(keepAlive);terminal.close();}
}catch(error){console.error('[FAIL]',error);process.exitCode=1;await writeFile(join(directory,'error.json'),JSON.stringify({error:String(error),published:false}));
 try{await driver.getSession().saveScreenshot(join(directory,'error.png'));await writeFile(join(directory,'error.xml'),await driver.getSession().getPageSource());}catch{}
}finally{await driver.disconnect().catch(error=>{console.error(error);process.exitCode=1;});console.log(`[SAFE] Sem publicação / sem benchmark. Artefatos: ${directory}`);}
