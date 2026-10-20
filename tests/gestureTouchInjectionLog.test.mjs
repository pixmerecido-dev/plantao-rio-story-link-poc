import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeTouchInjectionLog} from '../dist/gestureLab/touchInjectionLog.js';
const good=[
'I/appium: [100 (success)] Synthesized: MotionEvent { action=ACTION_DOWN, pointerCount=1 }',
'I/appium: [120 (success)] Synthesized: MotionEvent { action=ACTION_POINTER_DOWN(1), pointerCount=2 }',
'I/appium: [140 (success)] Synthesized: MotionEvent { action=ACTION_MOVE, pointerCount=2 }',
'I/appium: [160 (success)] Synthesized: MotionEvent { action=ACTION_UP, pointerCount=1 }'].join('\n');
test('accepted DOWN, POINTER_DOWN, two-contact MOVE and UP provide injection evidence only',()=>{const r=analyzeTouchInjectionLog(good);assert.equal(r.injection_sequence_observed,true);assert.equal(r.accepted_event_count,4);assert.equal(r.failed_event_count,0);assert.equal(r.evidence_scope,'DRIVER_REPORTED_INJECTION_NOT_INSTAGRAM_RECOGNITION');});
test('actual Android inconsistent DOWN diagnostic defeats apparent partial success',()=>{const log=good+'\nE/InputDispatcher: Invalid DOWN event - pointers already down\nE/InputDispatcher: ACTION_MOVE touching pointers don\'t match\nI/appium: [130 (fail)] Synthesized: MotionEvent { action=ACTION_DOWN, pointerCount=1 }';const r=analyzeTouchInjectionLog(log);assert.equal(r.injection_sequence_observed,false);assert.equal(r.failed_event_count,1);assert.equal(r.inconsistent_event_count,2);});
test('absent log or only one contact never establishes two-finger injection',()=>{assert.equal(analyzeTouchInjectionLog('').injection_sequence_observed,false);assert.equal(analyzeTouchInjectionLog(good.split('\n').filter(l=>!l.includes('POINTER_DOWN')).join('\n')).injection_sequence_observed,false);});
