import 'dotenv/config';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {InstagramDriver} from '../instagram/InstagramDriver.js';
import {nativeLabPort} from './runtime.js';
import {investigateMinimum,manualMinimumResult,minimumPinchActions} from './minSize.js';
const manual=process.argv[2]==='manual';
const directory=resolve('artifacts',`gesture-min-size${manual?'-manual':''}-${Date.now()}`);
const driver=new InstagramDriver();
await mkdir(directory,{recursive:true});
try {
  if(process.env.DRY_RUN!=='true') throw Error('Configure DRY_RUN=true.');
  if(manual&&(!stdin.isTTY||!stdout.isTTY)) throw Error('Controle manual exige terminal interativo com Enter.');
  await driver.checkAppium();await driver.connect();
  const session=driver.getSession(),port=nativeLabPort(driver,directory);
  if(manual) {
    const before=await port.read();await port.capture('manual-before');
    console.log(`Largura inicial: ${before.bounds.right-before.bounds.left}px. Faça pinch manual no emulador, sem publicar.`);
    // Keep the read-only session alive while the operator uses the emulator.
    const keepAlive=setInterval(()=>{void session.getCurrentPackage().catch(()=>{});},15000);
    const terminal=createInterface({input:stdin,output:stdout});
    try{await terminal.question('Quando terminar, pressione Enter neste terminal: ');}finally{clearInterval(keepAlive);terminal.close();}
    const after=await port.read();await port.capture('manual-after');
    const result=manualMinimumResult(before,after);
    await writeFile(join(directory,'min-size-manual-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } else {
    const result=await investigateMinimum({read:port.read,capture:port.capture,
      record:async value=>{console.log(JSON.stringify(value));await appendFile(join(directory,'attempts.jsonl'),JSON.stringify(value)+'\n');},
      pinch:async(plan,before)=>{
        const fresh=await port.read();
        if(JSON.stringify(fresh)!==JSON.stringify(before)) throw Error('Bounds mudaram antes do gesto; cancelado.');
        try{await session.performActions(minimumPinchActions(plan));}finally{await session.releaseActions();}
        await session.pause(1200);
      },
    });
    await writeFile(join(directory,'min-size-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
    if(['COMMAND_ERROR','UNEXPECTED_INCREASE'].includes(result.stop_reason)) process.exitCode=1;
  }
}catch(error){console.error('[FAIL]',error);process.exitCode=1;await writeFile(join(directory,'error.json'),JSON.stringify({error:String(error),published:false}));
  try{await driver.getSession().saveScreenshot(join(directory,'error.png'));await writeFile(join(directory,'error.xml'),await driver.getSession().getPageSource());}catch{}
}finally{await driver.disconnect().catch(error=>{console.error(error);process.exitCode=1;});console.log(`[SAFE] Sem publicação. Artefatos: ${directory}`);}
