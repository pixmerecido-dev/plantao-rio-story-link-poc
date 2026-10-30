import type {InstagramDriver} from './InstagramDriver.js';
import type {StoryJob} from '../config/StoryJob.js';
import {normalizeInstagramToHome} from './normalizeInstagramToHome.js';
import {detectInstagramState} from './instagramStateMachine.js';
import {clearCurrentLinkTransaction,inspectAppliedLinkSticker} from './appliedLinkSticker.js';
import {clearApprovedStickerLayout} from './approvedStickerLayout.js';
import {saveScreenArtifacts} from './diagnostics.js';
export interface ImageOnlyPort{
 clearLinkEvidence():void;
 normalizeHome():Promise<void>;
 state():Promise<string>;
 prepareNewImage():Promise<void>;
 confirmNoStickers():Promise<boolean>;
 capture():Promise<void>;
}
/** A separate, nonpublishing path: absence of a Link never bypasses Link publication guards. */
export async function prepareImageOnly(jobId:string,port:ImageOnlyPort){
 if(process.env.DRY_RUN!=='true')throw Error('Preparação exige DRY_RUN=true.');
 port.clearLinkEvidence();await port.normalizeHome();
 if(await port.state()!=='STATE_HOME')throw Error('Imagem sem link exige Home confirmado antes de criar Story.');
 await port.prepareNewImage();
 if(await port.state()!=='STATE_EDITOR'||!await port.confirmNoStickers())throw Error('Editor somente imagem não confirmado ou contém sticker anterior.');
 await port.capture();
 if(await port.state()!=='STATE_EDITOR'||!await port.confirmNoStickers())throw Error('Editor mudou antes da confirmação somente imagem.');
 return {job_id:jobId,content_mode:'IMAGE_ONLY' as const,published:false as const,layout_confirmed:true,image_loaded:true,editor_final_confirmed:true,no_stickers_confirmed:true,link_steps_skipped:true,sticker_added:false,url_verified:false,sticker_text_verified:false,move_command_sent:false,resize_command_sent:false};
}
export async function prepareImageOnlyStory(driver:Pick<InstagramDriver,'getSession'>,job:StoryJob,directory:string,loadNewImage:()=>Promise<void>){
 const session=driver.getSession();
 return prepareImageOnly(job.job_id,{
  clearLinkEvidence:()=>{clearCurrentLinkTransaction(session);clearApprovedStickerLayout(session);},
  normalizeHome:()=>normalizeInstagramToHome(driver,directory).then(()=>{}),
  state:()=>detectInstagramState(session),prepareNewImage:loadNewImage,
  confirmNoStickers:async()=>{if(await session.getCurrentPackage()!=='com.instagram.android')return false;const r=await inspectAppliedLinkSticker(session);return r.editorActive&&r.candidates.length===0&&r.liveVisualCandidates.length===0;},
  capture:()=>saveScreenArtifacts(driver,directory,'image-only-prepared').then(()=>{}),
 });
}
