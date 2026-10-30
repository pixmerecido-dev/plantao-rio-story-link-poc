import type {StoryJob} from '../config/StoryJob.js';
import {validateStoryJobInput} from '../config/prepareStoryJob.js';
import {resolveStoryMedia} from '../media/resolveStoryMedia.js';
import {assertExecutableStoryMedia} from '../media/StoryMedia.js';
export type PanelContentMode='IMAGE_WITH_LINK'|'IMAGE_ONLY';
export const panelContentMode=(includeLink:boolean):PanelContentMode=>includeLink?'IMAGE_WITH_LINK':'IMAGE_ONLY';
/** Image-only preparation neither needs nor validates a destination URL/CTA. */
export async function validatePanelContentJob(input:{job_id:string;media:string;story_url:string;sticker_text:string},includeLink:boolean):Promise<StoryJob>{
 if(includeLink)return validateStoryJobInput({...input,publish_instagram:false,publish_facebook:false});
 const media=await resolveStoryMedia(input.media,'image');assertExecutableStoryMedia(media);
 return {job_id:input.job_id,media,media_sha256:media.sha256,story_url:'',sticker_text:'',publish_instagram:false,publish_facebook:false};
}
export function validatePanelTestResult(result:Record<string,unknown>,id:string,mode:'layout'|'move',includeLink:boolean){
 if(result.job_id!==id||result.published!==false||result.layout_confirmed!==true)throw Error('Resultado do teste não comprovado.');
 if(!includeLink){
  if(mode==='move'||result.content_mode!=='IMAGE_ONLY'||result.image_loaded!==true||result.editor_final_confirmed!==true||result.no_stickers_confirmed!==true||result.link_steps_skipped!==true||result.sticker_added!==false||result.url_verified!==false||result.sticker_text_verified!==false||result.move_command_sent!==false||result.resize_command_sent!==false)throw Error('Modo somente imagem não comprovado.');
 }else if(mode==='move'){
  if(result.movement_confirmed!==true)throw Error('Movimento não comprovado.');
 }else if(result.content_mode==='IMAGE_ONLY'||result.style_transaction_confirmed!==true||result.style_confirmed!==true||result.size_ok!==true||result.position_ok!==true||result.image_loaded!==true||result.url_verified!==true||result.sticker_text_verified!==true||result.editor_final_confirmed!==true)throw Error('Layout com link não comprovado.');
}
