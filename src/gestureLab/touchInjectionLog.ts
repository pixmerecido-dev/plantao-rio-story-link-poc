/** Driver/Android evidence is distinct from Instagram recognizing a resize. */
export function analyzeTouchInjectionLog(source:string){
 const lines=source.split(/\r?\n/),synth=lines.filter(l=>/appium/i.test(l)&&/Synthesized: MotionEvent/.test(l));
 const accepted=synth.filter(l=>/\(success\)/.test(l)),failed=synth.filter(l=>/\(fail\)/.test(l));
 const errors=lines.filter(l=>/Inconsistent event:|Invalid DOWN event|touching pointers don't match|Input event injection .*failed/.test(l));
 const down=accepted.some(l=>/action=ACTION_DOWN[, }]/.test(l));
 const pointerDown=accepted.some(l=>/action=ACTION_POINTER_DOWN\(/.test(l)&&/pointerCount=2/.test(l));
 const move=accepted.some(l=>/action=ACTION_MOVE[, }]/.test(l)&&/pointerCount=2/.test(l));
 const up=accepted.some(l=>/action=ACTION_UP[, }]/.test(l));
 return {accepted_event_count:accepted.length,failed_event_count:failed.length,inconsistent_event_count:errors.length,
  single_contact_down_accepted:down,second_contact_down_accepted:pointerDown,two_contact_move_accepted:move,final_up_accepted:up,
  injection_sequence_observed:down&&pointerDown&&move&&up&&failed.length===0&&errors.length===0,
  injection_errors:errors.slice(0,8),evidence_scope:'DRIVER_REPORTED_INJECTION_NOT_INSTAGRAM_RECOGNITION'};
}
