import 'dotenv/config';
import {mkdir,writeFile,appendFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {InstagramDriver} from '../instagram/InstagramDriver.js';
import {nativeLabPort} from './runtime.js';
import {minimumPinchActions} from './minSize.js';
import {investigateNearMinGeometry,convergePreferredGeometry} from './nearMinGeometry.js';
import {ObservedSizeLimitStore} from './sizeLimitStore.js';
import {findObservedLimit} from '../admin/stickerSizeLimit.js';
const converge=process.argv[2]==='converge';
const directory=resolve('artifacts',`gesture-near-min-geometry${converge?'-converge':''}-${Date.now()}`),driver=new InstagramDriver();
await mkdir(directory,{recursive:true});
try{
 if(process.env.DRY_RUN!=='true')throw Error('Configure DRY_RUN=true.');
 await driver.checkAppium();await driver.connect();
 const session=driver.getSession(),live=nativeLabPort(driver,directory),initial=await live.read();
 const scope={text:process.env.GESTURE_STICKER_TEXT??'',style_index:Number(process.env.GESTURE_STYLE_INDEX??NaN),canvas_width:initial.canvas.right-initial.canvas.left,canvas_height:initial.canvas.bottom-initial.canvas.top,device:initial.device,instagram_version:process.env.GESTURE_INSTAGRAM_VERSION??null};
 const limit=findObservedLimit(await new ObservedSizeLimitStore(resolve(process.env.ADMIN_DATA_DIR??'data/admin','sticker-size-limits.json')).load(),scope);
 if(!limit)throw Error('Exige texto/estilo/dispositivo/canvas correspondentes ao mínimo observado.');
 const port={read:live.read,capture:live.capture,record:async(value:Record<string,unknown>)=>{console.log(JSON.stringify(value));await appendFile(join(directory,'attempts.jsonl'),JSON.stringify(value)+'\n');},pinch:async(plan:Parameters<typeof minimumPinchActions>[0],before:typeof initial)=>{
  if(JSON.stringify(await live.read())!==JSON.stringify(before))throw Error('Bounds mudaram antes do gesto.');
  try{await session.performActions(minimumPinchActions(plan));}finally{await session.releaseActions();}
  await session.pause(1200);
 }};
 let proof;
 if(converge){
  if(!process.env.GESTURE_NEAR_MIN_GEOMETRY_REPORT)throw Error('Exige GESTURE_NEAR_MIN_GEOMETRY_REPORT.');
  proof=JSON.parse(await readFile(resolve(process.env.GESTURE_NEAR_MIN_GEOMETRY_REPORT),'utf8'));
  if(JSON.stringify(proof.minimum_limit_scope)!==JSON.stringify(limit.scope))throw Error('Configuração da geometria mudou.');
 }
 const result=converge?await convergePreferredGeometry(port,limit.observed_min_width,proof):await investigateNearMinGeometry(port,limit.observed_min_width);
 const report={...result,minimum_limit_scope:limit.scope};
 await writeFile(join(directory,converge?'near-min-geometry-converge-report.json':'near-min-geometry-report.json'),JSON.stringify(report,null,2));
 console.table(result.attempts.map(r=>({geometry:r.geometry,attempt:r.attempt,travel:r.travel_px_per_finger,before:r.before_width,after:r.after_width,delta:r.delta_px,drift:r.center_drift,effect:r.effect,valid:r.valid,success:r.success})));
 console.log(JSON.stringify(report));
 if(converge?!('success' in result&&result.success):!('near_min_effective' in result&&result.near_min_effective))process.exitCode=1;
}catch(error){console.error('[FAIL]',error);process.exitCode=1;await writeFile(join(directory,'error.json'),JSON.stringify({error:String(error),published:false}));
 try{await liveCapture();}catch{}
}finally{await driver.disconnect().catch(error=>{console.error(error);process.exitCode=1;});console.log(`[SAFE] Sem publicação. Artefatos: ${directory}`);}
async function liveCapture(){await driver.getSession().saveScreenshot(join(directory,'error.png'));await writeFile(join(directory,'error.xml'),await driver.getSession().getPageSource());}
