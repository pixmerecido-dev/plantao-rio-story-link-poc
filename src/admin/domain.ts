export const PUBLICATION_STATUSES = ['QUEUED','PREPARING','READY','PUBLISHING','SUCCESS','FAILED','INCONCLUSIVE','CANCELLED'] as const;
export type PublicationStatus = typeof PUBLICATION_STATUSES[number];
export const EVENT_TYPES = ['JOB_CREATED','MEDIA_RESOLVED','INSTAGRAM_HOME','STORY_EDITOR','MEDIA_LOADED','LINK_ADDED','STICKER_TEXT_APPLIED','STICKER_RESIZED','STICKER_POSITIONED','LAYOUT_CONFIRMED','PUBLISH_CLICKED','FACEBOOK_PROMPT_HANDLED','PUBLISH_CONFIRMED','SUCCESS','FAILED','ARTIFACT_IMPORTED'] as const;
export type EventType = typeof EVENT_TYPES[number];
export const REFERENCE = { width:1080,height:1920,stickerWidthBefore:696,stickerWidth:529,stickerHeight:88,centerX:347.5,centerY:1138 };
export const ADMIN_TIMEZONE = 'America/Sao_Paulo';
export interface StorySettings {
  story: { sticker: { text:string;scale:number;x_pct:number;y_pct:number;enabled:boolean;min_scale:number;max_scale:number } };
  publishing: { instagram_enabled:boolean;facebook_enabled:boolean };
  safety: { require_link_confirmation:boolean;require_layout_confirmation:boolean;abort_on_layout_failure:boolean };
}
export function defaultSettings(): StorySettings {
  return { story:{ sticker:{ text:'Leia a matéria completa',scale:REFERENCE.stickerWidth/REFERENCE.stickerWidthBefore,x_pct:REFERENCE.centerX/REFERENCE.width,y_pct:REFERENCE.centerY/REFERENCE.height,enabled:true,min_scale:0.5,max_scale:1 } },
    publishing:{ instagram_enabled:true,facebook_enabled:true },safety:{ require_link_confirmation:true,require_layout_confirmation:true,abort_on_layout_failure:true } };
}
export interface PublicationJob {
  id:string;job_id:string;created_at:string;started_at:string|null;finished_at:string|null;published_at:string|null;
  media_path:string|null;media_type:'IMAGE'|'VIDEO'|'UNSUPPORTED';media_filename:string|null;story_url:string;sticker_text:string;
  sticker_scale:number|null;sticker_x:number|null;sticker_y:number|null;
  instagram_status:string;facebook_crosspost:boolean|null;status:PublicationStatus;attempts:number;duration_ms:number|null;
  error_code:string|null;error_message:string|null;source_key?:string;source_note?:string;
}
export interface PublicationEvent { id:string;job_id:string;timestamp:string;event:EventType;message:string;metadata?:Record<string,unknown> }
export interface AdminState { version:1;settings:StorySettings;publication_jobs:PublicationJob[];publication_events:PublicationEvent[] }
export class ValidationError extends Error {}
const object = (value:unknown):Record<string,unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Objeto esperado.'); return value as Record<string,unknown>; };
const number = (value:unknown,min:number,max:number,label:string) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new ValidationError(`${label}: valor fora dos limites.`); return value; };
const bool = (value:unknown,label:string) => { if (typeof value !== 'boolean') throw new ValidationError(`${label}: booleano esperado.`); return value; };
export function validateSettings(value:unknown):StorySettings {
  const root=object(value),sticker=object(object(root.story).sticker),publishing=object(root.publishing),safety=object(root.safety);
  if (typeof sticker.text !== 'string' || !sticker.text.trim() || sticker.text.length > 140) throw new ValidationError('Texto do sticker deve ter entre 1 e 140 caracteres.');
  const min=number(sticker.min_scale,0.25,1.25,'Tamanho mínimo'),max=number(sticker.max_scale,0.25,1.25,'Tamanho máximo');
  if (min > max) throw new ValidationError('Mínimo não pode ultrapassar o máximo.');
  for (const key of ['require_link_confirmation','require_layout_confirmation','abort_on_layout_failure']) if (safety[key] !== true) throw new ValidationError('As confirmações de segurança devem permanecer ativas.');
  return { story:{ sticker:{ text:sticker.text,scale:number(sticker.scale,min,max,'Escala'),x_pct:number(sticker.x_pct,0,1,'Posição horizontal'),y_pct:number(sticker.y_pct,0,1,'Posição vertical'),enabled:bool(sticker.enabled,'Sticker habilitado'),min_scale:min,max_scale:max } },
    publishing:{ instagram_enabled:bool(publishing.instagram_enabled,'Instagram'),facebook_enabled:bool(publishing.facebook_enabled,'Facebook') },
    safety:{ require_link_confirmation:true,require_layout_confirmation:true,abort_on_layout_failure:true } };
}
export function validateJob(value:PublicationJob):PublicationJob {
  if (!value.id || !value.job_id || value.id.length>128 || value.job_id.length>128 || !PUBLICATION_STATUSES.includes(value.status)) throw new ValidationError('Identidade/status do job inválidos.');
  if (!['IMAGE','VIDEO','UNSUPPORTED'].includes(value.media_type)) throw new ValidationError('Tipo de mídia inválido.');
  for (const date of [value.created_at,value.started_at,value.finished_at,value.published_at]) if (date!==null && (typeof date!=='string' || !Number.isFinite(Date.parse(date)))) throw new ValidationError('Data do job inválida.');
  let url:URL; try { url=new URL(value.story_url); } catch { throw new ValidationError('URL da matéria inválida.'); }
  if (!['http:','https:'].includes(url.protocol)) throw new ValidationError('URL HTTP(S) obrigatória.');
  if (typeof value.sticker_text!=='string' || value.sticker_text.length>500) throw new ValidationError('Texto inválido.');
  if (!Number.isInteger(value.attempts) || value.attempts<0) throw new ValidationError('Tentativas inválidas.');
  if (value.duration_ms!==null) number(value.duration_ms,0,Number.MAX_SAFE_INTEGER,'Duração');
  for (const v of [value.sticker_scale,value.sticker_x,value.sticker_y]) if (v!==null) number(v,0,Number.MAX_SAFE_INTEGER,'Layout');
  if (value.facebook_crosspost!==null) bool(value.facebook_crosspost,'Crosspost');
  for (const text of [value.media_path,value.media_filename,value.error_code,value.error_message,value.instagram_status]) if (text!==null && typeof text!=='string') throw new ValidationError('Campo textual do job inválido.');
  const keys=['id','job_id','created_at','started_at','finished_at','published_at','media_path','media_type','media_filename','story_url','sticker_text','sticker_scale','sticker_x','sticker_y','instagram_status','facebook_crosspost','status','attempts','duration_ms','error_code','error_message','source_key','source_note'] as const;
  return structuredClone(Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]))) as unknown as PublicationJob;
}
export function validateEvent(value:PublicationEvent):PublicationEvent {
  if (!value.id || !value.job_id || !EVENT_TYPES.includes(value.event) || !Number.isFinite(Date.parse(value.timestamp)) || typeof value.message!=='string') throw new ValidationError('Evento inválido.');
  if (value.metadata!==undefined) object(value.metadata);
  return structuredClone(value);
}
