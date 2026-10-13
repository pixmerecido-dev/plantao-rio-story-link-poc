import { readFileSync, existsSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const permits=(values,actual)=>!values || (!values.includes(`!${actual}`) && (values.every(v=>v.startsWith('!')) || values.includes(actual)));
function entry(value){
 if(typeof value==='string')return value;
 if(!value||typeof value!=='object')return null;
 for(const key of ['node','import','module-sync','default','require']){const found=entry(value[key]);if(found)return found;}
 return null;
}
/** Validate the existing npm tree before deciding to remove it with ci. No installation or process killing. */
export function inspectDependencies(root,platform=process.platform,arch=process.arch){
 try{
  const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  const expected=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8')).packages;
  const installed=JSON.parse(readFileSync(join(root,'node_modules/.package-lock.json'),'utf8')).packages;
  if(!expected || !installed)return{valid:false,reason:'Registro de dependências ausente.'};
  for(const [name,range] of Object.entries({...manifest.dependencies,...manifest.devDependencies})){
   if(expected['']?.dependencies?.[name]!==range && expected['']?.devDependencies?.[name]!==range)return{valid:false,reason:'Manifesto e lockfile divergentes.'};
  }
  for(const [key,pkg] of Object.entries(expected)){
   if(!key.startsWith('node_modules/') || !permits(pkg.os,platform)||!permits(pkg.cpu,arch))continue;
   const actual=installed[key];
   if(!actual){if(pkg.optional)continue;return{valid:false,reason:'Dependência obrigatória ausente.'};}
   if(actual.version!==pkg.version || (pkg.integrity && actual.integrity!==pkg.integrity))return{valid:false,reason:'Versão instalada divergente.'};
   const physical=JSON.parse(readFileSync(join(root,key,'package.json'),'utf8'));
   if(physical.version!==pkg.version)return{valid:false,reason:'Instalação incompleta.'};
  }
  for(const name of Object.keys({...manifest.dependencies,...manifest.devDependencies})){
   if(!installed[`node_modules/${name}`])return{valid:false,reason:'Dependência principal ausente.'};
   const pkgRoot=join(root,'node_modules',name),pkg=JSON.parse(readFileSync(join(pkgRoot,'package.json'),'utf8'));
   const target=entry(pkg.exports?.['.']??pkg.exports)??pkg.main??pkg.types;
   if(target&&!target.includes('*')&&!existsSync(join(pkgRoot,target)))return{valid:false,reason:'Arquivo de inicialização de dependência ausente.'};
  }
  for(const file of ['node_modules/typescript/bin/tsc','node_modules/appium/index.js'])if(!existsSync(join(root,file)))return{valid:false,reason:'Componente de inicialização ausente.'};
  return{valid:true,reason:'Dependências existentes conferidas.'};
 }catch{return{valid:false,reason:'Instalação ausente ou incompleta.'};}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=inspectDependencies(resolve(process.argv[2]??'.'));console.log(JSON.stringify(result));process.exitCode=result.valid?0:2;
}
