import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connectedAndroidDevice, saveAddStoryContext, compareStoryOpenContexts } from '../dist/instagram/addStoryAndroidDiagnostics.js';

test('ADB usa UDID efetivo da sessão, nunca dispositivo padrão', () => {
  assert.equal(connectedAndroidDevice({ capabilities: { deviceUDID: 'real-connected', 'appium:udid': 'requested' } }), 'real-connected');
  assert.equal(connectedAndroidDevice({ capabilities: { 'appium:udid': 'emulator-5556' } }), 'emulator-5556');
  assert.throws(() => connectedAndroidDevice({}), /UDID/);
});
test('diagnóstico salva pacote/activity/foco/elemento/hierarquia sem interação', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-context-'));
  const commands = [];
  const session = { capabilities: { udid: 'emulator-5556' }, getCurrentPackage: async () => 'com.instagram.android',
    getCurrentActivity: async () => '.MainActivity', getPageSource: async () => '<hierarchy/>' };
  const result = await saveAddStoryContext(session, directory, 'before', { bounds: '[1,2][5,8]', elementId: 'fresh' }, async (device, args) => {
    commands.push([device, args]); return { stdout: 'other detail\nmCurrentFocus=Window{com.instagram.android/MainActivity}\nmFocusedApp=ActivityRecord{Instagram}', stderr: '' };
  });
  assert.deepEqual(commands, [['emulator-5556', ['shell', 'dumpsys', 'window']]]);
  assert.equal(result.currentActivity, '.MainActivity'); assert.equal(result.windowFocus.length, 2);
  assert.equal(JSON.parse(await readFile(join(directory, 'before.json'), 'utf8')).elementId, 'fresh');
  assert.equal(await readFile(join(directory, 'before.xml'), 'utf8'), '<hierarchy/>');
});
test('foco indisponível é registrado sem inventar estado de janela', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-context-'));
  const result = await saveAddStoryContext({ getCurrentPackage: async () => 'com.instagram.android', getPageSource: async () => '<hierarchy/>' }, directory, 'before', {});
  assert.equal(result.currentActivity, null); assert.deepEqual(result.windowFocus, []);
  assert.ok(result.errors.windowFocus);
});
test('comparação relata diferenças observadas sem concluir causalidade', () => {
  const normal = { currentPackage: 'com.instagram.android', currentActivity: '.MainActivity', bounds: '[1,2][3,4]', elementId: 'session-1', windowFocus: ['Instagram'], pageSourceSha256: 'hash1' };
  const media = { ...normal, elementId: 'session-2', windowFocus: ['System overlay'], pageSourceSha256: 'hash2' };
  const report = compareStoryOpenContexts(normal, media);
  assert.deepEqual(report.differences.map(diff => diff.field), ['windowFocus', 'elementId', 'pageSourceSha256']);
  assert.match(report.note, /não comprovam/);
});
