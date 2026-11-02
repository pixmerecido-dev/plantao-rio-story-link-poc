import 'dotenv/config';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {scanOperationsCorruption} from '../admin/scanOperationsCorruption.js';
try{
 if(process.argv.length>2)throw Error('Este diagnóstico não recebe argumentos nem aplica alterações.');
 const filename=resolve(process.env.ADMIN_DATA_DIR??'data/admin','operations.json');
 const report=await scanOperationsCorruption(filename,bytes=>console.log(`[SCAN] ${bytes} bytes lidos`));
 const path=`${filename}.corruption-survey-${Date.now()}-${randomUUID()}.json`;
 await writeFile(path,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(report,null,2));console.log(`Relatório: ${path}`);
 console.log('[SAFE] Somente leitura do armazenamento. Nenhum reparo, reset ou publicação.');
 if(report.source_changed_during_scan)process.exitCode=1;
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
