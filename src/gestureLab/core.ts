export type Box = {left:number;top:number;right:number;bottom:number};
export type Snapshot = {bounds:Box;canvas:Box;identity:string;device:string};
export type MoveMethod = 'W3C'|'ADB-700'|'ADB-1000'|'ADB-1300'|'NATIVE';
export interface LabPort {
  read():Promise<Snapshot>;
  capture(name:string):Promise<void>;
  move(method:MoveMethod,start:Point,target:Point):Promise<void>;
  resize(method:'NATIVE'|'W3C',bounds:Box,factor:number):Promise<void>;
}
export type Point={x:number;y:number};
export const center=(b:Box):Point=>({x:(b.left+b.right)/2,y:(b.top+b.bottom)/2});
export const width=(b:Box)=>b.right-b.left;
export function validateSnapshot(s:Snapshot) {
  for(const b of [s.bounds,s.canvas]) if(!Object.values(b).every(Number.isFinite)||width(b)<=0||b.bottom<=b.top) throw Error('Bounds inválidos.');
  if(!s.identity||!s.device||s.bounds.left<s.canvas.left||s.bounds.right>s.canvas.right||s.bounds.top<s.canvas.top||s.bounds.bottom>s.canvas.bottom) throw Error('Sticker fora do canvas ou identificação ausente.');
}
export function safeTarget(s:Snapshot,p:Point):Point {
  validateSnapshot(s);
  const hw=width(s.bounds)/2,hh=(s.bounds.bottom-s.bounds.top)/2;
  return {x:Math.max(s.canvas.left+hw,Math.min(s.canvas.right-hw,p.x)),y:Math.max(s.canvas.top+hh,Math.min(s.canvas.bottom-hh,p.y))};
}
export function movementMetrics(before:Snapshot,after:Snapshot,target:Point) {
  validateSnapshot(before);validateSnapshot(after);
  if(before.identity!==after.identity||before.device!==after.device||JSON.stringify(before.canvas)!==JSON.stringify(after.canvas)) throw Error('Objeto/canvas/dispositivo mudou; medição inválida.');
  const start=center(before.bounds),end=center(after.bounds);
  const expected={x:target.x-start.x,y:target.y-start.y},actual={x:end.x-start.x,y:end.y-start.y};
  const distance=Math.hypot(expected.x,expected.y),error=Math.hypot(actual.x-expected.x,actual.y-expected.y);
  const progress=distance>0?(actual.x*expected.x+actual.y*expected.y)/(distance*distance):0;
  const sameSize=Math.abs(width(after.bounds)-width(before.bounds))<=2&&Math.abs((after.bounds.bottom-after.bounds.top)-(before.bounds.bottom-before.bounds.top))<=2;
  return {before_center:start,target_center:target,after_center:end,expected_delta:expected,actual_delta:actual,movement_error:error,progress_ratio:progress,success:distance>=50&&Math.hypot(actual.x,actual.y)>=20&&progress>=0.70&&error<=distance*0.30&&sameSize};
}
export async function moveTrial(port:LabPort,method:MoveMethod,target:Point,name:string) {
  const before=await port.read();validateSnapshot(before);
  const safe=safeTarget(before,target);
  if(Math.hypot(safe.x-center(before.bounds).x,safe.y-center(before.bounds).y)<50) throw Error('Espaço insuficiente para deslocamento mensurável; não enviar gesto.');
  await port.capture(`${name}-before`);
  let command_error:string|null=null;
  try{await port.move(method,center(before.bounds),safe);}catch(e){command_error=String(e);}
  const after=await port.read();await port.capture(`${name}-after`);
  return {method,before,after,...movementMetrics(before,after,safe),command_error};
}
export async function benchmarkMove(port:LabPort) {
  const initial=await port.read();validateSnapshot(initial);
  const start=center(initial.bounds),target=safeTarget(initial,{x:start.x-150,y:start.y+200});
  const attempts:Awaited<ReturnType<typeof moveTrial>>[]=[];
  let winner:MoveMethod|null=null;
  for(const method of ['W3C','ADB-700','ADB-1000','ADB-1300','NATIVE'] as MoveMethod[]) {
    const fresh=await port.read(),c=center(fresh.bounds);
    const result=await moveTrial(port,method,{x:c.x-150,y:c.y+200},`discovery-${method}`);
    attempts.push(result);
    if(result.success&&!result.command_error){winner=method;break;}
  }
  const rounds:Awaited<ReturnType<typeof moveTrial>>[]=[];
  if(winner) {
    // Alternate two known targets, restoring the initial position between outward rounds.
    for(let i=0;i<5;i++) {
      const destination=i%2===0?start:target;
      const trial=await moveTrial(port,winner,destination,`repeat-${i+1}-${winner}`);
      rounds.push(trial);
      if(!trial.success||trial.command_error) break;
    }
  }
  const qualified=rounds.length===5&&rounds.every(r=>r.success&&!r.command_error);
  return {kind:'move',comparison: (['W3C','ADB-700','ADB-1000','ADB-1300','NATIVE'] as MoveMethod[]).map(method=>({method,status:attempts.find(r=>r.method===method)?.success ? 'PASS' : attempts.some(r=>r.method===method) ? 'FAIL' : 'NOT_TESTED'})),initial,attempts,rounds,candidate:winner,recommended:qualified?winner:null,qualified,passed:rounds.filter(r=>r.success&&!r.command_error).length,total:5,last:await port.read(),published:false};
}
export async function resizeTrial(port:LabPort,scale:number,method:'NATIVE'|'W3C',name:string) {
  if(![0.9,0.8,1.1].includes(scale)) throw Error('Use escala controlada 0.9, 0.8 ou 1.1.');
  const before=await port.read();validateSnapshot(before);
  const target=width(before.bounds)*scale,iterations=[];
  await port.capture(`${name}-before`);
  let after=before;
  for(let i=0;i<4&&Math.abs(width(after.bounds)-target)>target*0.03;i++) {
    const fresh=await port.read();validateSnapshot(fresh);
    const factor=Math.max(0.90,Math.min(1.10,target/width(fresh.bounds)));
    let command_error:string|null=null;
    try{await port.resize(method,fresh.bounds,factor);}catch(e){command_error=String(e);}
    after=await port.read();validateSnapshot(after);
    if(after.identity!==before.identity||after.device!==before.device||JSON.stringify(after.canvas)!==JSON.stringify(before.canvas)) throw Error('Objeto mudou durante resize.');
    await port.capture(`${name}-iteration-${i+1}`);
    iterations.push({before:fresh,after,factor,command_error});
    if(command_error) break;
  }
  await port.capture(`${name}-after`);
  const actual_scale=width(after.bounds)/width(before.bounds),error=(width(after.bounds)-target)/target;
  const drift=Math.hypot(center(after.bounds).x-center(before.bounds).x,center(after.bounds).y-center(before.bounds).y);
  return {method,requested_scale:scale,before,after,before_width:width(before.bounds),before_height:before.bounds.bottom-before.bounds.top,after_width:width(after.bounds),after_height:after.bounds.bottom-after.bounds.top,iterations,actual_scale,error,center_drift:drift,success:iterations.length>0&&iterations.every(i=>!i.command_error)&&Math.abs(error)<=0.03&&Math.abs(width(after.bounds)-width(before.bounds))>=2&&drift<=Math.max(5,width(before.canvas)*0.02)};
}
export async function benchmarkResize(port:LabPort,method:'NATIVE'|'W3C') {
  const rounds=[];
  for(let i=0;i<5;i++) {
    const result=await resizeTrial(port,[0.9,1.1,0.8,1.1,0.9][i]!,method,`resize-${method}-${i+1}`);
    rounds.push(result);if(!result.success) break;
  }
  const qualified=rounds.length===5&&rounds.every(r=>r.success);
  return {kind:'resize',method,rounds,qualified,recommended:qualified?method:null,passed:rounds.filter(r=>r.success).length,total:5,mean_absolute_error:rounds.reduce((sum,r)=>sum+Math.abs(r.error),0)/rounds.length,last:await port.read(),published:false};
}
