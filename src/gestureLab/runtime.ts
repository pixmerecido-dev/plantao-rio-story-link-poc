import type {InstagramDriver} from '../instagram/InstagramDriver.js';
import { inspectAppliedLinkSticker } from '../instagram/appliedLinkSticker.js';
import { stickerBox } from '../instagram/linkStickerLayout.js';
import { buildSteppedStickerMoveActions,buildStickerPinchActions } from '../instagram/stickerTouchActions.js';
import {connectedAndroidDevice,runAndroidCommand} from '../instagram/addStoryAndroidDiagnostics.js';
import { saveScreenArtifacts } from '../instagram/diagnostics.js';
import type {LabPort,Snapshot} from './core.js';
import {center,validateSnapshot,width} from './core.js';
export function nativeLabPort(driver:Pick<InstagramDriver,'getSession'>,directory:string):LabPort {
  const session=driver.getSession();
  let identity:string|undefined;
  const read=async():Promise<Snapshot>=>{
    if(await session.getCurrentPackage()!=='com.instagram.android') throw Error('Instagram fora de primeiro plano. Abra o editor manualmente; laboratório não navega.');
    const report=await inspectAppliedLinkSticker(session);
    if(!report.editorActive||report.liveVisualCandidates.length!==1) throw Error('Exige editor com exatamente um sticker visível no canvas. Não cria nem reconstrói Story.');
    const c=report.liveVisualCandidates[0]!;
    // Generic accessibility describes a visual sticker, not its semantic type.
    // This lab measures the user-provided object; it cannot authorize publication.
    const key=JSON.stringify([c.resourceId,c.contentDesc,c.text,c.class]);
    if(identity&&identity!==key) throw Error('Identidade do objeto mudou.');
    identity=key;
    const snapshot={bounds:stickerBox(c.bounds),canvas:c.canvasBounds,identity:key,device:connectedAndroidDevice(session)};
    validateSnapshot(snapshot);return snapshot;
  };
  return {
    read,
    capture:async name=>{await saveScreenArtifacts(driver,directory,name);},
    move:async(method,start,target)=>{
      const fresh=await read();
      if (Math.hypot(center(fresh.bounds).x-start.x,center(fresh.bounds).y-start.y)>1) throw Error("Centro mudou antes do movimento; gesto cancelado.");
      if(method==='W3C') {
        try{await session.performActions(buildSteppedStickerMoveActions(start,target));}finally{await session.releaseActions();}
      }else if(method.startsWith('ADB-')) {
        const duration=method.split('-')[1]!;
        await runAndroidCommand(connectedAndroidDevice(session),['shell','input','touchscreen','swipe',String(Math.round(start.x)),String(Math.round(start.y)),String(Math.round(target.x)),String(Math.round(target.y)),duration]);
      }else{
        // Isolated UiAutomator2 drag prototype; benchmark measures its effect, not assumed success.
        await session.execute('mobile: dragGesture',{startX:Math.round(start.x),startY:Math.round(start.y),endX:Math.round(target.x),endY:Math.round(target.y),speed:250});
      }
      await session.pause(1000);
    },
    resize:async(method,bounds,factor,strength)=>{
      const fresh=await read();
      if(JSON.stringify(fresh.bounds)!==JSON.stringify(bounds)) throw Error('Bounds mudaram antes do pinch.');
      if(method==='NATIVE') await session.execute(factor<1?'mobile: pinchCloseGesture':'mobile: pinchOpenGesture',{
        left:bounds.left,top:bounds.top,width:width(bounds),height:bounds.bottom-bounds.top,percent:strength ?? Math.min(0.1,Math.max(0.02,Math.abs(1-factor))),
      });
      else{
        try{await session.performActions(buildStickerPinchActions(center(bounds),width(bounds),factor));}finally{await session.releaseActions();}
      }
      await session.pause(1000);
    },
  };
}
