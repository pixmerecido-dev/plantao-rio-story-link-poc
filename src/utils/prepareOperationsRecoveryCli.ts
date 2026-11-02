import 'dotenv/config';
import {resolve,join} from 'node:path';
import {readdir,readFile,stat} from 'node:fs/promises';
import {activateOperationsRecovery} from '../admin/activateOperationsRecovery.js';
import {prepareOperationsRecovery} from '../admin/prepareOperationsRecovery.js';
try{
 const args=process.argv.slice(2);
 const prepare=args.length===1&&args[0]==='--prepare';
 const activate=args.length===4&&args[0]==='--activate'&&args[1]==='--accept-partial-recovery'&&args[2]==='--candidate-sha'&&/^[a-f0-9]{64}$/.test(args[3]!);
 if(!prepare&&!activate)throw Error('Use --prepare ou --activate --accept-partial-recovery --candidate-sha HASH_REVISADO.');
 const folder=resolve(process.env.ADMIN_DATA_DIR??'data/admin'),filename=join(folder,'operations.json');
 if(activate){
  const candidates=(await readdir(folder)).filter(n=>/^operations\.json\.recovery-candidate-[0-9]+-[a-f0-9-]+\.json\.report\.json$/.test(n));
  let selected:string|undefined;
  for(const name of candidates){const path=join(folder,name);const r=JSON.parse(await readFile(path,'utf8'));if(r.candidate_sha256===args[3]){selected=path;break;}}
  if(!selected)throw Error('Relatório do candidato revisado não encontrado.');
  const report=await activateOperationsRecovery(filename,selected,args[3]!,true);
  console.log(JSON.stringify(report,null,2));
  console.log(report.backup?'[SAFE] Backup integral preservado. Publicação e RSS permanecem desativados.':'[SAFE] Candidato já ativo; nenhuma substituição realizada. Publicação e RSS desativados.');
 }else{
 const names=(await readdir(folder)).filter(n=>/^operations\.json\.corruption-survey-[0-9]+-[a-f0-9-]+\.json$/.test(n));
 const list=await Promise.all(names.map(async name=>({path:join(folder,name),mtime:(await stat(join(folder,name))).mtimeMs})));
 const latest=list.sort((a,b)=>b.mtime-a.mtime)[0];if(!latest)throw Error('Varredura anterior não encontrada. Execute diagnose:operations-corruption antes.');
 const survey=JSON.parse(await readFile(latest.path,'utf8'));
 if(survey.kind!=='operations-corruption-survey'||survey.source_changed_during_scan!==false)throw Error('Varredura de referência inválida.');
 const result=await prepareOperationsRecovery(filename,survey.sha256,stage=>console.log(`[RECOVERY] ${stage}`));
 console.log(JSON.stringify(result.report,null,2));console.log(`Relatório para revisão: ${result.reportPath}`);
 console.log('[SAFE] Original preservado. Candidato não ativado. Sem reset da fila original e sem publicação.');
 }
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
