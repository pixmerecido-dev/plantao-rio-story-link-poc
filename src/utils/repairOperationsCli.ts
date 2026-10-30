import 'dotenv/config';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {repairOperationsStore} from '../admin/repairOperationsStore.js';
const args=process.argv.slice(2);
try{
 if(args.some(a=>a!=='--apply'))throw Error('Use sem argumentos para diagnóstico ou --apply para aplicar com backup.');
 const filename=resolve(process.env.ADMIN_DATA_DIR??'data/admin','operations.json');
 const report=await repairOperationsStore(filename,args.includes('--apply'));
 console.log(JSON.stringify(report,null,2));
 if(report.applied&&report.backup){
  const path=`${report.backup}.report.json`;
  await writeFile(path,JSON.stringify(report,null,2),{mode:0o600});console.log(`Relatório: ${path}`);
 }
 if(report.status==='REPAIRABLE')console.log('Nenhuma gravação realizada. Para aplicar com backup: npm run repair:operations -- --apply');
 console.log('[SAFE] Nenhum reset de fila, conta ou configurações. Nenhuma publicação.');
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
