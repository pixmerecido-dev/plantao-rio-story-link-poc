/** Browser-safe calibration contract. No filesystem, account access or gesture injection. */
export interface StickerLimitScope { text:string;style_index:number;canvas_width:number;canvas_height:number;device:string;instagram_version:string|null }
export interface ObservedStickerLimit {scope:StickerLimitScope;observed_min_width:number;reference_initial_width:number;evidence:'MANUAL_AND_AUTOMATIC';recorded_at:string|null}
export const CURRENT_LIMIT_SCOPE:StickerLimitScope={text:'Leia a matéria completa',style_index:0,canvas_width:1080,canvas_height:1920,device:'emulator-5554',instagram_version:null};
export const CURRENT_OBSERVED_LIMIT:ObservedStickerLimit={scope:CURRENT_LIMIT_SCOPE,observed_min_width:504,reference_initial_width:727,evidence:'MANUAL_AND_AUTOMATIC',recorded_at:null};
export const MINIMUM_SIZE_MESSAGE='Tamanho mínimo permitido pelo Instagram para este link.';
export function limitScopeKey(s:StickerLimitScope){return JSON.stringify([s.text,s.style_index,s.canvas_width,s.canvas_height,s.device,s.instagram_version]);}
export function findObservedLimit(limits:ObservedStickerLimit[],scope:StickerLimitScope){return limits.find(l=>limitScopeKey(l.scope)===limitScopeKey(scope));}
export function panelObservedLimit(limits:ObservedStickerLimit[],text:string,style:number){return findObservedLimit(limits,{...CURRENT_LIMIT_SCOPE,text,style_index:style});}
export function minimumScale(limit:ObservedStickerLimit){return limit.observed_min_width/limit.reference_initial_width;}
export function clampScale(scale:number,limit?:ObservedStickerLimit){return limit?Math.max(scale,minimumScale(limit)):scale;}
