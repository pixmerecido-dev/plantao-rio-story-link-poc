import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { InstagramDriver } from '../instagram/InstagramDriver.js';
import { beginLinkLayoutTransform, inspectAppliedLinkSticker, requireCurrentLinkTransaction } from '../instagram/appliedLinkSticker.js';
import { stickerBox } from '../instagram/linkStickerLayout.js';
import { saveScreenArtifacts } from '../instagram/diagnostics.js';
import { connectedAndroidDevice, runAndroidCommand } from '../instagram/addStoryAndroidDiagnostics.js';
export function isolatedMoveActions(start: {x:number;y:number}, target: {x:number;y:number}) {
  const actions: any[] = [{type:'pointerMove',origin:'viewport',duration:0,x:Math.round(start.x),y:Math.round(start.y)}, {type:'pointerDown',button:0},{type:'pause',duration:700}];
  for (const fraction of [0.15,0.30,0.45,0.60,0.75,0.90,1]) actions.push({type:'pointerMove',origin:'viewport',duration:150,x:Math.round(start.x+(target.x-start.x)*fraction),y:Math.round(start.y+(target.y-start.y)*fraction)}, {type:'pause',duration:30});
  actions.push({type:'pointerUp',button:0});
  return [{type:'pointer',id:'isolated-story-move',parameters:{pointerType:'touch'},actions}];
}
export async function isolatedStickerMove(driver: Pick<InstagramDriver,'getSession'>, jobId: string, directory: string) {
  if (process.env.DRY_RUN !== "true") throw Error("Movimento isolado exige Modo Teste.");
  const session = driver.getSession();
  const read = async () => {
    await requireCurrentLinkTransaction(session, jobId);
    const report = await inspectAppliedLinkSticker(session);
    if (!report.editorActive || report.liveVisualCandidates.length !== 1) throw Error('Movimento exige um único Link do job atual.');
    const sticker = report.liveVisualCandidates[0]!;
    const bounds = stickerBox(sticker.bounds);
    return {bounds,canvas:sticker.canvasBounds,center:{x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2}};
  };
  const before = await read();
  const halfWidth = (before.bounds.right-before.bounds.left)/2, halfHeight=(before.bounds.bottom-before.bounds.top)/2;
  const target={x:Math.max(before.canvas.left+halfWidth,before.center.x-150),y:Math.min(before.canvas.bottom-halfHeight,before.center.y+200)};
  console.log('MOVE_ISOLATED_BEFORE',JSON.stringify(before)); console.log('MOVE_ISOLATED_TARGET',JSON.stringify(target));
  await saveScreenArtifacts(driver,directory,'move-isolated-before');
  let accept = await beginLinkLayoutTransform(session,jobId);
  try { await session.performActions(isolatedMoveActions(before.center,target)); } finally { await session.releaseActions(); }
  await session.pause(1000); await accept();
  let after=await read();
  const w3c=structuredClone(after);
  await saveScreenArtifacts(driver,directory,'move-isolated-w3c');
  let strategy='W3C';
  const changed=(a:typeof before,b:typeof before)=>Math.hypot(b.center.x-a.center.x,b.center.y-a.center.y);
  if (changed(before,after)<2) {
    console.log('MOVE_W3C_FAILED');
    const fresh=await read();
    if(await session.getCurrentPackage()!=='com.instagram.android') throw Error('Pacote mudou; ADB cancelado.');
    accept=await beginLinkLayoutTransform(session,jobId);
    console.log('MOVE_ADB_ATTEMPT',JSON.stringify({start:fresh.center,target,duration:1400}));
    await runAndroidCommand(connectedAndroidDevice(session),['shell','input','touchscreen','swipe',String(Math.round(fresh.center.x)),String(Math.round(fresh.center.y)),String(Math.round(target.x)),String(Math.round(target.y)),'1400']);
    await session.pause(1000); await accept(); after=await read(); strategy='ADB';
    await saveScreenArtifacts(driver,directory,'move-isolated-adb');
    console.log('MOVE_ADB_AFTER',JSON.stringify(after)); console.log('MOVE_ADB_SUCCESS',changed(fresh,after)>=20);
  }
  const delta={x:after.center.x-before.center.x,y:after.center.y-before.center.y};
  const success=changed(before,after)>=20;
  console.log('MOVE_ISOLATED_AFTER',JSON.stringify(after));console.log('MOVE_ISOLATED_DELTA',JSON.stringify(delta));console.log('MOVE_ISOLATED_SUCCESS',success);
  await writeFile(join(directory,'move-isolated.json'),JSON.stringify({job_id:jobId,before,target,w3c_after:w3c,after,delta,strategy,success,published:false},null,2));
  if(!success) throw Error('Movimento isolado não confirmado; nenhuma publicação.');
  return {layout_confirmed:true,movement_confirmed:true,published:false as const};
}
