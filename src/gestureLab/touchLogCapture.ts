import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const run=promisify(execFile);
export async function startTouchLog(device:string){
 const adb=process.env.ADB_PATH||(process.platform==='win32'&&process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe'):'adb');
 const child=spawn(adb,['-s',device,'logcat','-v','threadtime','-T','1'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const token=`GESTURE_TOUCH_${randomUUID()}`;let data='',stderr='',truncated=false,closed=false;
 const finished=new Promise<void>(resolve=>child.once('close',()=>{closed=true;resolve();}));
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',(chunk:string)=>{if(data.length+chunk.length<=8*1024*1024)data+=chunk;else truncated=true;});
 child.stderr.on('data',(chunk:string)=>{stderr=(stderr+chunk).slice(-4000);});
 try{
  await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  await run(adb,['-s',device,'shell','log','-t','GESTURE_LAB',token],{timeout:5000,windowsHide:true});
  const deadline=Date.now()+5000;
  while(!data.includes(token)&&Date.now()<deadline&&!closed)await new Promise(r=>setTimeout(r,50));
  if(!data.includes(token))throw Error(`Logcat não confirmou início da coleta: ${stderr}`);
 }catch(error){child.kill();throw error;}
 return {stop:async()=>{
  child.kill();await Promise.race([finished,new Promise<void>(r=>setTimeout(r,1000))]);
  const offset=data.indexOf(token),start=data.indexOf('\n',offset);
  return {text:start<0?'':data.slice(start+1),truncated,stderr};
 }};
}
