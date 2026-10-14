import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedMoveActions } from '../dist/local/isolatedStickerMove.js';
test('isolated move holds one touch through seven gradual steps without intermediate release', () => {
  const [pointer] = isolatedMoveActions({x:540,y:960},{x:390,y:1160});
  assert.equal(pointer.parameters.pointerType,'touch');
  assert.equal(pointer.actions.filter(a=>a.type==='pointerDown').length,1);
  assert.equal(pointer.actions.filter(a=>a.type==='pointerUp').length,1);
  assert.equal(pointer.actions[2].duration,700);
  const moves=pointer.actions.filter(a=>a.type==='pointerMove');
  assert.equal(moves.length,8);
  assert.deepEqual({x:moves.at(-1).x,y:moves.at(-1).y},{x:390,y:1160});
  assert.equal(pointer.actions.at(-1).type,'pointerUp');
  for(let i=1;i<moves.length;i++){ assert.ok(moves[i].x<=moves[i-1].x); assert.ok(moves[i].y>=moves[i-1].y); }
});
