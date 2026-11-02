import 'dotenv/config';
import {resolve,join} from 'node:path';
import {readdir,readFile,stat} from 'node:fs/promises';
import {prepareOperationsRecovery} from '../admin/prepareOperationsRecovery.js';
try{
 if(process.argv.length!==3||process.argv[2]!=='--prepare')throw Error('Use --prepare: gera somente candidato separado, sem ativar ou substituir dados.');
 const folder=resolve(process.env.ADMIN_DATA_DIR??'data/admin'),filename=join(folder,'operations.json');
 const names=(await readdir(folder)).filter(n=>/^operations\.json\.corruption-survey-[0-9]+-[a-f0-9-]+\.json$/.test(n));
 const list=await Promise.all(names.map(async name=>({path:join(folder,name),mtime:(await stat(join(folder,name))).mtimeMs})));
 const latest=list.sort((a,b)=>b.mtime-a.mtime)[0];if(!latest)throw Error('Varredura anterior não encontrada. Execute diagnose:operations-corruption antes.');
 const survey=JSON.parse(await readFile(latest.path,'utf8'));
 if(survey.kind!=='operations-corruption-survey'||survey.source_changed_during_scan!==false)throw Error('Varredura de referência inválida.');
 const result=await prepareOperationsRecovery(filename,survey.sha256,stage=>console.log(`[RECOVERY] ${stage}`));
 console.log(JSON.stringify(result.report,null,2));console.log(`Relatório para revisão: ${result.reportPath}`);
 console.log('[SAFE] Original preservado. Candidato não ativado. Sem reset da fila original e sem publicação.');
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
