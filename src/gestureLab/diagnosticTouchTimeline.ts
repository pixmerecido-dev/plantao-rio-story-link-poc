import {analyzeTouchInjectionLog} from './touchInjectionLog.js';
/** Raw driver logs are evidence of injection, not app-side gesture recognition. */
export function diagnosticTouchTimeline(source:string){
 const events=source.split(/\r?\n/).flatMap((raw,line)=>{
  if(!/appium/i.test(raw)||!raw.includes('Synthesized: MotionEvent'))return [];
  const action=/action=(ACTION_[A-Z_]+)(?:\((\d+)\))?/.exec(raw);
  if(!action)return [];
  const number=(key:string)=>{const v=new RegExp(`\\b${key}=([0-9.]+)`).exec(raw);return v?Number(v[1]):null;};
  const pointerCount=number('pointerCount');
  const pointers=Array.from({length:Math.min(pointerCount??0,10)},(_,index)=>{
   const field=(key:string)=>{const v=new RegExp(`\\b${key}\\[${index}\\]=(-?[0-9.]+)`).exec(raw);return v?Number(v[1]):null;};
   return {index,id:field('id'),x:field('x'),y:field('y')};
  });
  return [{sequence:line+1,action:action[1]!,action_pointer_index:action[2]?Number(action[2]):null,pointer_count:pointerCount,pointers,
   injection_timestamp_ms:(/\[(\d+)\s+\((?:success|fail)\)\]/.exec(raw)?.[1]??null)===null?null:Number(/\[(\d+)\s+\((?:success|fail)\)\]/.exec(raw)![1]),
   event_time_ms:number('eventTime'),down_time_ms:number('downTime'),logcat_timestamp:/^\s*(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)/.exec(raw)?.[1]??null,
   accepted:/\(success\)/.test(raw),raw}];
 });
 const accepted=events.filter(e=>e.accepted),actions=accepted.map(e=>e.action);
 const down=actions.indexOf('ACTION_DOWN'),second=actions.indexOf('ACTION_POINTER_DOWN'),move=accepted.findIndex(e=>e.action==='ACTION_MOVE'&&e.pointer_count===2),pointerUp=actions.indexOf('ACTION_POINTER_UP'),up=actions.lastIndexOf('ACTION_UP');
 const ordered=down===0&&second>down&&move>second&&pointerUp>move&&up===accepted.length-1&&up>pointerUp&&actions.filter(a=>a==='ACTION_DOWN').length===1&&actions.filter(a=>a==='ACTION_POINTER_DOWN').length===1;
 const times=accepted.map(e=>e.event_time_ms??e.injection_timestamp_ms),completeTimes=times.length>0&&times.every(t=>t!==null);
 const monotonic=completeTimes?times.every((t,i)=>i===0||t!>=times[i-1]!):null;
 const twoContacts=accepted.filter(e=>e.pointer_count===2),idsObserved=twoContacts.length>0&&twoContacts.every(e=>e.pointers.every(p=>p.id!==null));
 const expectedIds=idsObserved?twoContacts[0]!.pointers.map(p=>p.id).sort().join(','):null;
 const idsConsistent=idsObserved?twoContacts.every(e=>new Set(e.pointers.map(p=>p.id)).size===2&&e.pointers.map(p=>p.id).sort().join(',')===expectedIds):null;
 const countsValid=ordered&&accepted[down]!.pointer_count===1&&accepted[second]!.pointer_count===2&&accepted[pointerUp]!.pointer_count===2&&accepted[up]!.pointer_count===1;
 const downTimes=[...new Set(accepted.flatMap(e=>e.down_time_ms===null?[]:[e.down_time_ms]))];
 const evidence=analyzeTouchInjectionLog(source);
 return {...evidence,events,ordered_two_pointer_sequence:ordered,pointer_count_sequence_valid:countsValid,two_contact_ids_consistent:idsConsistent,event_timing_observed:completeTimes,timestamps_monotonic:monotonic,
  single_down_time:downTimes.length?downTimes.length===1:null,
  actual_duration_ms:completeTimes?times.at(-1)!-times[0]!:null,timing_source:accepted.some(e=>e.event_time_ms!==null)?'MOTION_EVENT_EVENT_TIME':'DRIVER_INJECTION_LOG_TIMESTAMP',
  pointer_coordinates_observed:accepted.some(e=>e.pointer_count===2&&e.pointers.every(p=>p.id!==null&&p.x!==null&&p.y!==null)),
  sequence_valid:evidence.injection_sequence_observed&&ordered&&countsValid&&idsConsistent!==false&&monotonic!==false&&downTimes.length<=1,
  contacts_received_by_instagram:'NOT_OBSERVED',evidence_scope:'DRIVER_REPORTED_INJECTION_NOT_APP_HIT_TEST'};
}
