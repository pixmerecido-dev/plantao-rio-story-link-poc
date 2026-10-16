import 'dotenv/config';
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {InstagramDriver} from '../instagram/InstagramDriver.js';
import {nativeLabPort} from './runtime.js';
import {calibrateAnchors,anchorPlan,anchorActions,anchorMetrics,REFERENCE_ANCHORS,type AnchorPlan,type AnchorDirection} from './anchorCalibration.js';
import {annotatedAnchorScreenshot} from './anchorScreenshot.js';
import type {Snapshot} from './core.js';
const manual=process.argv[2]==='ctrl-mouse',driver=new InstagramDriver(),directory=resolve('artifacts',`gesture-anchor-${manual?'ctrl-mouse':'calibration'}-${Date.now()}`);
await mkdir(directory,{recursive:true});
try{
 if(process.env.DRY_RUN!=='true')throw Error('Configure DRY_RUN=true.');
 const text=process.env.GESTURE_STICKER_TEXT,style=Number(process.env.GESTURE_STYLE_INDEX??NaN);
 if(!text?.trim()||![0,1,2,3].includes(style))throw Error('Informe GESTURE_STICKER_TEXT e GESTURE_STYLE_INDEX do sticker visível.');
 if(manual&&(!stdin.isTTY||!stdout.isTTY))throw Error('Ctrl + mouse exige terminal interativo.');
 const direction=process.env.GESTURE_ANCHOR_DIRECTION??'in';
 if(manual&&!['in','out'].includes(direction))throw Error('GESTURE_ANCHOR_DIRECTION deve ser in ou out.');
 await driver.checkAppium();await driver.connect();
 const session=driver.getSession(),live=nativeLabPort(driver,directory);
 const mark=async(name:string,before:Snapshot,plan:AnchorPlan)=>{
  const viewport=await session.getWindowRect(),file=join(directory,`${name}-anchors.svg`);
  const source=await readFile(join(directory,`${name}.png`));
  await writeFile(file,annotatedAnchorScreenshot(source,before,plan,viewport));
  await writeFile(join(directory,`${name}-viewport.json`),JSON.stringify({viewport,coordinate_source:'accessibility bounds / viewport pointer coordinates',annotation:'calculated only; no color detection; does not prove injected touch positions'},null,2));
  return file;
 };
 const context={text_declared_by_operator:text,style_index:style,instagram_version:process.env.GESTURE_INSTAGRAM_VERSION??null,text_semantically_verified:false};
 if(manual){
  const before=await live.read(),plan=anchorPlan(before,REFERENCE_ANCHORS,direction as AnchorDirection);
  await live.capture('ctrl-mouse-before');const screenshot=await mark('ctrl-mouse-before',before,plan);
  console.log(`Referência RED calculada: ${JSON.stringify(plan.red)}. Abra ${screenshot}. No emulador, use Ctrl + mouse nessa região para ${direction==='in'?'reduzir':'aumentar'}. Nenhum gesto será enviado pelo programa.`);
  const terminal=createInterface({input:stdin,output:stdout}),keepAlive=setInterval(()=>{void session.getCurrentPackage().catch(()=>{});},15000);
  try{await terminal.question('Ao terminar o gesto manual, pressione Enter aqui: ');}finally{clearInterval(keepAlive);terminal.close();}
  const after=await live.read();await live.capture('ctrl-mouse-after');
  const metrics=anchorMetrics(before,after,direction as AnchorDirection);
  const report={kind:'anchor-ctrl-mouse-manual',context,before,after,reference_plan:plan,screenshot,...metrics,success:metrics.valid&&metrics.directional_effect,automated_touch_sent:false,manual_pointer_path_observed:false,published:false};
  await writeFile(join(directory,'anchor-ctrl-mouse-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.success)process.exitCode=1;
 }else{
  const result=await calibrateAnchors({read:live.read,capture:live.capture,mark,
   record:async value=>{console.log(JSON.stringify(value));await appendFile(join(directory,'attempts.jsonl'),JSON.stringify(value)+'\n');},
   pinch:async(plan,before)=>{
    if(JSON.stringify(await live.read())!==JSON.stringify(before))throw Error('Bounds mudaram antes do gesto.');
    try{await session.performActions(anchorActions(plan));}finally{await session.releaseActions();}
    await session.pause(1200);
   }});
  const report={...result,context,anchor_status:'INITIAL_VISUAL_REFERENCE_REQUIRES_REAL_VALIDATION',cross_text_validation:'NOT_EXECUTED'};
  await writeFile(join(directory,'anchor-calibration-report.json'),JSON.stringify(report,null,2));
  console.table(result.attempts.map(a=>({direction:a.direction,attempt:a.attempt,before:a.before_width,after:a.after_width,delta:a.delta_width,drift:a.center_drift,effect:a.effect,success:a.success})));
  console.log(JSON.stringify(report));if(!result.PINCH_IN_EFFECTIVE||!result.PINCH_OUT_EFFECTIVE)process.exitCode=1;
 }
}catch(error){console.error('[FAIL]',error);process.exitCode=1;await writeFile(join(directory,'error.json'),JSON.stringify({error:String(error),published:false}));
 try{await driver.getSession().saveScreenshot(join(directory,'error.png'));await writeFile(join(directory,'error.xml'),await driver.getSession().getPageSource());}catch{}
}finally{await driver.disconnect().catch(error=>{console.error(error);process.exitCode=1;});console.log(`[SAFE] Sem publicação / sem benchmark. Artefatos: ${directory}`);}
