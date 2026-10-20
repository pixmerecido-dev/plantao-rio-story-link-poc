import {anchorPlan,anchorMetrics,sameAnchorObject,type AnchorPort} from './anchorCalibration.js';
import {validateSnapshot,width} from './core.js';
export const FROZEN_RESIZE_ANCHORS=Object.freeze({red:Object.freeze({x:.95,y:.29}),green:Object.freeze({x:.04,y:.70})});
export const ANCHOR_TEXT_CASES=['short','standard','long'] as const;
export type AnchorTextCase=typeof ANCHOR_TEXT_CASES[number];
export const STANDARD_ANCHOR_TEXT='Leia a matéria completa';
export function validateCaseText(id:AnchorTextCase,text:string){
 if(typeof text!=='string'||!text.trim())throw Error('Informe o texto real aceito no sticker.');
 if(id==='short'&&text!=='Veja')throw Error('Texto curto deve ser Veja.');
 if(id==='standard'&&text!==STANDARD_ANCHOR_TEXT)throw Error('Texto padrão divergente.');
 if(id==='long'&&Array.from(text.trim()).length<=Array.from(STANDARD_ANCHOR_TEXT).length)throw Error('Informe um texto longo aceito, maior que o texto padrão.');
}
export async function validateAnchorText(port:AnchorPort,id:AnchorTextCase,text:string,style_index:number){
 validateCaseText(id,text);if(![0,1,2,3].includes(style_index))throw Error('Estilo inválido.');
 const initial=await port.read();validateSnapshot(initial);
 const attempts=[];let stop_reason='COMPLETED';
 for(const direction of ['in','out'] as const){
  const before=await port.read();sameAnchorObject(initial,before);
  const plan=anchorPlan(before,FROZEN_RESIZE_ANCHORS,direction),name=`text-${id}-${direction}`;
  await port.capture(`${name}-before`);const screenshot=await port.mark(`${name}-before`,before,plan);
  const command={case_id:id,direction,sticker_bounds:before.bounds,red_anchor_percent:plan.percent.red,green_anchor_percent:plan.percent.green,red_anchor_px:plan.red,green_anchor_px:plan.green,finger1_start:plan.finger1_start,finger1_end:plan.finger1_end,finger2_start:plan.finger2_start,finger2_end:plan.finger2_end,contraction:plan.contraction,screenshot};
  await port.record({phase:'COMMAND',...command});let command_error:string|null=null;
  try{await port.pinch(plan,before);}catch(error){command_error=String(error);}
  const after=await port.read();sameAnchorObject(initial,after);await port.capture(`${name}-after`);
  const metrics=anchorMetrics(before,after,direction,initial),result={...command,before,after,...metrics,command_error,success:!command_error&&metrics.valid&&metrics.directional_effect};
  attempts.push(result);await port.record(result);
  if(command_error||!metrics.valid){stop_reason=command_error?'COMMAND_ERROR':'INVALID_DRIFT';break;}
  // A NO_EFFECT is a failed direction, not permission for a retry or a new search.
 }
 const pinch_in=attempts.find(a=>a.direction==='in')??null,pinch_out=attempts.find(a=>a.direction==='out')??null;
 return {case_id:id,text_declared_by_operator:text,text_semantically_verified:false,style_index,initial,initial_width:width(initial.bounds),attempts,pinch_in,pinch_out,stop_reason,success:pinch_in?.success===true&&pinch_out?.success===true,published:false};
}
export type TextCaseResult=Awaited<ReturnType<typeof validateAnchorText>>;
export function anchorTextReport(cases:TextCaseResult[]){
 const ids=cases.map(c=>c.case_id),complete=cases.length===3&&ANCHOR_TEXT_CASES.every(id=>ids.filter(x=>x===id).length===1);
 const qualified=complete&&cases.every(c=>c.success)&&cases.every(c=>c.style_index===cases[0]!.style_index&&c.initial.device===cases[0]!.initial.device&&JSON.stringify(c.initial.canvas)===JSON.stringify(cases[0]!.initial.canvas));
 return {kind:'anchor-text-validation',method:'W3C_DIAGONAL',frozen_anchors:FROZEN_RESIZE_ANCHORS,search_performed:false,cases,passed:cases.filter(c=>c.success).length,total:3,complete,ANCHOR_GEOMETRY_QUALIFIED:qualified,qualification_scope:'operator-declared texts, current device/canvas/style/version only; not universal',long_text_limit_verified:false,controller_integration:'NOT_PERFORMED',benchmark_executed:false,published:false};
}
export async function validateAnchorTexts(prepare:(id:AnchorTextCase)=>Promise<{text:string;style_index:number;port:AnchorPort}>,progress:(report:ReturnType<typeof anchorTextReport>)=>Promise<void>=async()=>{}){
 const cases:TextCaseResult[]=[];
 for(const id of ANCHOR_TEXT_CASES){
  const input=await prepare(id);
  const result=await validateAnchorText(input.port,id,input.text,input.style_index);
  cases.push(result);await progress(anchorTextReport(cases));
  if(result.stop_reason!=='COMPLETED')break;
 }
 return anchorTextReport(cases);
}
