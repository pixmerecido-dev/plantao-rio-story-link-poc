import {anchorMetrics,sameAnchorObject} from './anchorCalibration.js';
import {validateSnapshot,type Snapshot,type Point,type Box} from './core.js';
import {validateSynchronizedTouchActions} from './shortTouchExecution.js';
export type ViewportRect={x:number;y:number;width:number;height:number};
export type MirrorDirection='in'|'out';
export type MirrorPlan={direction:MirrorDirection;distance_factor:number;model:'EMULATOR_SCREEN_CENTER_HYPOTHESIS';viewport:ViewportRect;center:Point;inside_anchor_percent:{x:number;y:number};growth_factor:number;finger1_start:Point;finger1_end:Point;finger2_start:Point;finger2_end:Point;planned_angle_delta_degrees:number};
const inside=(p:Point,b:Box,margin=0)=>p.x>b.left+margin&&p.x<b.right-margin&&p.y>b.top+margin&&p.y<b.bottom-margin;
export function emulatorMirrorPlan(snapshot:Snapshot,viewport:ViewportRect,direction:MirrorDirection='out'):MirrorPlan{
 if(direction!=='in'&&direction!=='out')throw Error('Direção inválida.');
 validateSnapshot(snapshot);
 if(!Object.values(viewport).every(Number.isFinite)||viewport.width<=0||viewport.height<=0)throw Error('Viewport inválido.');
 const center={x:viewport.x+viewport.width/2,y:viewport.y+viewport.height/2},b=snapshot.bounds;
 const first={x:Math.round(b.left+(b.right-b.left)*.95),y:Math.round(b.top+(b.bottom-b.top)*.29)};
 const mirror=(p:Point)=>({x:Math.round(2*center.x-p.x),y:Math.round(2*center.y-p.y)});
 const second=mirror(first),growth_factor=direction==='out'?1.20:1/1.20,end={x:Math.round(center.x+(first.x-center.x)*growth_factor),y:Math.round(center.y+(first.y-center.y)*growth_factor)},secondEnd=mirror(end);
 if(!inside(first,b)||inside(second,b))throw Error('O ensaio exige primeiro contato dentro e segundo fora do sticker.');
 const screen={left:viewport.x,top:viewport.y,right:viewport.x+viewport.width,bottom:viewport.y+viewport.height};
 for(const p of [first,second,end,secondEnd])if(!inside(p,screen,16)||!inside(p,snapshot.canvas,2))throw Error('Trajetória fora do canvas seguro. Coloque o sticker na região central antes do teste; nenhum gesto foi enviado.');
 if(Math.hypot(first.x-second.x,first.y-second.y)<40||Math.hypot(first.x-end.x,first.y-end.y)<3)throw Error('Separação/deslocamento insuficiente.');
 const angle=(a:Point,z:Point)=>Math.atan2(z.y-a.y,z.x-a.x)*180/Math.PI;
 const delta=((angle(end,secondEnd)-angle(first,second)+540)%360)-180;
 if(Math.abs(delta)>1)throw Error('Arredondamento produziu rotação planejada excessiva.');
 return {direction,distance_factor:growth_factor,model:'EMULATOR_SCREEN_CENTER_HYPOTHESIS',viewport,center,inside_anchor_percent:{x:.95,y:.29},growth_factor,finger1_start:first,finger1_end:end,finger2_start:second,finger2_end:secondEnd,planned_angle_delta_degrees:delta};
}
export function emulatorMirrorActions(p:MirrorPlan){
 const pointer=(id:string,start:Point,end:Point)=>({type:'pointer' as const,id,parameters:{pointerType:'touch' as const},actions:[
  {type:'pointerMove' as const,origin:'viewport' as const,duration:0,...start},{type:'pointerDown' as const,button:0},
  ...Array.from({length:10},(_,i)=>({type:'pointerMove' as const,origin:'viewport' as const,duration:60,x:Math.round(start.x+(end.x-start.x)*(i+1)/10),y:Math.round(start.y+(end.y-start.y)*(i+1)/10)})),{type:'pointerUp' as const,button:0}]});
 const sources=[pointer('mirror-inside',p.finger1_start,p.finger1_end),pointer('mirror-outside',p.finger2_start,p.finger2_end)];
 validateSynchronizedTouchActions(sources);return sources;
}
export interface MirrorPort{read():Promise<Snapshot>;capture(name:string):Promise<void>;record(value:Record<string,unknown>):Promise<void>;pinch(plan:MirrorPlan,before:Snapshot):Promise<void>;}
export async function testEmulatorMirrorPinch(port:MirrorPort,viewport:ViewportRect,direction:MirrorDirection='out'){
 const before=await port.read(),plan=emulatorMirrorPlan(before,viewport,direction),actions=emulatorMirrorActions(plan);
 await port.capture(`mirror-${direction}-before`);await port.record({phase:'COMMAND',before,plan,actions});
 let command_error:string|null=null;
 try{await port.pinch(plan,before);}catch(error){command_error=String(error);}
 const after=await port.read();sameAnchorObject(before,after);await port.capture(`mirror-${direction}-after`);
 const metrics=anchorMetrics(before,after,direction);
 const result={kind:'short-emulator-mirror-pinch',direction,before,after,plan,actions,...metrics,command_error,measured_resize_success:!command_error&&metrics.valid&&metrics.directional_effect,geometry_qualification:'NOT_EVALUATED',benchmark_executed:false,published:false};
 await port.record(result);return result;
}
