import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectDependencies} from '../scripts/windows/dependency-check.mjs';
async function fixture(){
 const root=await mkdtemp('/tmp/windows-deps-');const pkg={version:'1.0.0',integrity:'sha512-example'};
 await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{example:'^1.0.0'}}));
 const packages={'':{dependencies:{example:'^1.0.0'}},'node_modules/example':pkg};
 await writeFile(join(root,'package-lock.json'),JSON.stringify({packages}));await mkdir(join(root,'node_modules/example'),{recursive:true});await mkdir(join(root,'node_modules/typescript/bin'),{recursive:true});await mkdir(join(root,'node_modules/appium'),{recursive:true});
 await writeFile(join(root,'node_modules/.package-lock.json'),JSON.stringify({packages:{'node_modules/example':pkg}}));await writeFile(join(root,'node_modules/example/package.json'),JSON.stringify({version:'1.0.0',main:'index.js'}));await writeFile(join(root,'node_modules/example/index.js'),'');await writeFile(join(root,'node_modules/typescript/bin/tsc'),'');await writeFile(join(root,'node_modules/appium/index.js'),'');
 return{root,packages};
}
test('primeira abertura reaproveita árvore existente íntegra sem stamp do launcher',async()=>{const {root}=await fixture();assert.equal(inspectDependencies(root,'win32','x64').valid,true);});
test('ci parcialmente removido é detectado antes de abrir backend',async()=>{const {root}=await fixture();await unlink(join(root,'node_modules/example/index.js'));assert.equal(inspectDependencies(root).valid,false);});
test('versão ou integridade divergentes exigem instalação',async()=>{for(const field of ['version','integrity']){const{root}=await fixture();await writeFile(join(root,'node_modules/.package-lock.json'),JSON.stringify({packages:{'node_modules/example':{version:'1.0.0',integrity:'sha512-example',[field]:'different'}}}));assert.equal(inspectDependencies(root).valid,false);}});
test('registro npm ausente e manifesto diferente não são aceitos por stamp antigo',async()=>{const{root}=await fixture();await writeFile(join(root,'launcher-lock.sha256'),'old');await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{example:'^2.0.0'}}));assert.equal(inspectDependencies(root).valid,false);await unlink(join(root,'node_modules/.package-lock.json'));assert.equal(inspectDependencies(root).valid,false);});
test('pacote obrigatório da outra plataforma não provoca reinstall indevido no Windows',async()=>{const {root,packages}=await fixture();packages['node_modules/linux-only']={version:'1.0.0',os:['linux']};await writeFile(join(root,'package-lock.json'),JSON.stringify({packages}));assert.equal(inspectDependencies(root,'win32','x64').valid,true);assert.equal(inspectDependencies(root,'linux','x64').valid,false);});
