import {ObservedSizeLimitStore} from './sizeLimitStore.js';
import {findObservedLimit} from '../admin/stickerSizeLimit.js';
import 'dotenv/config';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {InstagramDriver} from '../instagram/InstagramDriver.js';
import {nativeLabPort} from './runtime.js';
import {benchmarkMove,benchmarkResize,resizeTrial,center} from './core.js';
const mode=process.argv[2];
const directory=resolve('artifacts',`gesture-lab-${mode}-${Date.now()}`);
const driver=new InstagramDriver();
await mkdir(directory,{recursive:true});
try{
  if(process.env.DRY_RUN!=='true') throw Error('Configure DRY_RUN=true. Laboratório não publica.');
  if(!['move','resize','benchmark','manual','pinch-out'].includes(mode??'')) throw Error('Modo inválido.');
  await driver.checkAppium();await driver.connect();
  // Never activateApp, navigate, normalize, create sticker or access a publishing flow.
  const port=nativeLabPort(driver,directory),before=await port.read();
  console.log('GESTURE_STICKER_FOUND=true',JSON.stringify({before_bounds:before.bounds,before_center:center(before.bounds),before_width:before.bounds.right-before.bounds.left,before_height:before.bounds.bottom-before.bounds.top}));
  await port.capture('initial');
  let moveProof;
  if(mode==='move'||mode==='benchmark'){
    moveProof=await benchmarkMove(port);
    await writeFile(join(directory,'move-report.json'),JSON.stringify(moveProof,null,2));
    console.table([...moveProof.attempts,...moveProof.rounds].map(r=>({method:r.method,success:r.success,requested:JSON.stringify(r.expected_delta),actual:JSON.stringify(r.actual_delta),error:r.movement_error,command_error:r.command_error})));
    if(!moveProof.qualified) throw Error('MOVE não alcançou 5/5. Resize bloqueado; nenhuma reintegração.');
  }
  if(mode==='resize'||mode==='pinch-out'){
    const proofPath=process.env.GESTURE_MOVE_REPORT;
    if(!proofPath) throw Error('Exige GESTURE_MOVE_REPORT apontando para move-report.json com 5/5 reais.');
    moveProof=JSON.parse(await readFile(resolve(proofPath),'utf8'));
    if(moveProof.kind!=='move'||moveProof.qualified!==true||moveProof.rounds?.length!==5||!moveProof.rounds.every((r:any)=>r.success&&!r.command_error)||JSON.stringify(moveProof.last)!==JSON.stringify(before)) throw Error('Prova MOVE inválida ou editor/sticker/dispositivo mudou. Execute benchmark MOVE novamente.');
  }
  if(mode==='resize'||mode==='benchmark'||mode==='pinch-out'){
    const method=process.env.GESTURE_RESIZE_METHOD??'NATIVE';
    if(!['NATIVE','W3C'].includes(method)) throw Error('GESTURE_RESIZE_METHOD deve ser NATIVE ou W3C.');
    const limits=await new ObservedSizeLimitStore(resolve(process.env.ADMIN_DATA_DIR??'data/admin','sticker-size-limits.json')).load();
    const scope=process.env.GESTURE_STICKER_TEXT!==undefined&&process.env.GESTURE_STYLE_INDEX!==undefined?{
      text:process.env.GESTURE_STICKER_TEXT,style_index:Number(process.env.GESTURE_STYLE_INDEX),
      canvas_width:before.canvas.right-before.canvas.left,canvas_height:before.canvas.bottom-before.canvas.top,
      device:before.device,instagram_version:process.env.GESTURE_INSTAGRAM_VERSION??null,
    }:null;
    const limit=scope?findObservedLimit(limits,scope):undefined;
    console.log('OBSERVED_MINIMUM',JSON.stringify({scope,limit:limit??null,source:'configuration-scoped registry'}));
    const report=mode==='pinch-out' ? await resizeTrial(port,1.1,method as 'NATIVE'|'W3C','pinch-out-controlled',limit) : process.env.GESTURE_SCALE
      ?await resizeTrial(port,Number(process.env.GESTURE_SCALE),method as 'NATIVE'|'W3C','resize-controlled',limit)
      :await benchmarkResize(port,method as 'NATIVE'|'W3C',limit);
    await writeFile(join(directory,mode==='pinch-out'?'pinch-out-report.json':'resize-report.json'),JSON.stringify(report,null,2));
    console.log('RESIZE',JSON.stringify(report));
    if(('qualified' in report&&!report.qualified)||('success' in report&&!report.success)) throw Error('RESIZE não confirmado. Nenhuma reintegração.');
  }
  if(mode==='manual'){
    await port.capture('manual-before');
    console.log('Mova o sticker manualmente nos próximos 30 segundos. Não publique.');
    await driver.getSession().pause(30000);
    const after=await port.read();await port.capture('manual-after');
    await writeFile(join(directory,'manual-report.json'),JSON.stringify({before,after,delta:{x:center(after.bounds).x-center(before.bounds).x,y:center(after.bounds).y-center(before.bounds).y},bounds_changed:JSON.stringify(before.bounds)!==JSON.stringify(after.bounds),published:false},null,2));
  }
}catch(error){
  console.error('[FAIL]',error);process.exitCode=1;
  await writeFile(join(directory,'error.json'),JSON.stringify({error:String(error),published:false},null,2));
  try{await driver.getSession().saveScreenshot(join(directory,'error.png'));await writeFile(join(directory,'error.xml'),await driver.getSession().getPageSource());}catch{}
}finally{await driver.disconnect().catch(e=>{console.error(e);process.exitCode=1;});console.log(`[SAFE] Nenhuma publicação. Artefatos: ${directory}`);}
