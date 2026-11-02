import 'dotenv/config';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {repairOperationsStore,OperationsRepairScanError,type RepairProgress} from '../admin/repairOperationsStore.js';
const args=process.argv.slice(2),filename=resolve(process.env.ADMIN_DATA_DIR??'data/admin','operations.json');
let stage='ARGUMENTS',replaced=false;const observations:RepairProgress[]=[];
try{
 if(args.some(a=>a!=='--apply'))throw Error('Use sem argumentos para diagnóstico ou --apply para aplicar com backup.');
 const report=await repairOperationsStore(filename,args.includes('--apply'),step=>{
  stage=step.stage;if(stage==='REPLACED')replaced=true;observations.push(step);
  console.log(`[REPAIR] ${stage}${typeof step.file_size_bytes==='number'?` — ${step.file_size_bytes} bytes`:''}`);
 });
 console.log(JSON.stringify(report,null,2));
 if(report.applied&&report.backup){
  const path=`${report.backup}.report.json`;
  await writeFile(path,JSON.stringify(report,null,2),{mode:0o600});console.log(`Relatório: ${path}`);
 }
 if(report.status==='REPAIRABLE')console.log('Nenhuma gravação realizada. Para aplicar com backup: npm run repair:operations -- --apply');
 console.log('[SAFE] Nenhum reset de fila, conta ou configurações. Nenhuma publicação.');
}catch(error){
 const cause=error instanceof Error?error.cause:undefined;
 const diagnostic={status:'FAILED',filename,stage,original_file_replaced:replaced,error_name:error instanceof Error?error.name:typeof error,message:error instanceof Error?error.message:'Erro desconhecido',
  cause_name:cause instanceof Error?cause.name:null,cause_location:cause instanceof Error?(/position \d+(?: \(line \d+ column \d+\))?/.exec(cause.message)?.[0]??null):null,
  details:error instanceof OperationsRepairScanError?error.diagnostic:null,observations,publication_executed:false};
 const path=`${filename}.repair-diagnostic-${Date.now()}-${randomUUID()}.json`;
 console.error(JSON.stringify(diagnostic,null,2));
 await writeFile(path,JSON.stringify(diagnostic,null,2),{mode:0o600}).then(()=>console.error(`Diagnóstico: ${path}`)).catch(()=>console.error('Não foi possível salvar o diagnóstico.'));
 process.exitCode=1;
}
