import test, { after } from 'node:test';
const previousDryRun = process.env.DRY_RUN;
process.env.DRY_RUN = 'true';
after(() => { if (previousDryRun === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previousDryRun; });
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAddStory, inspectAddStoryControl } from '../dist/instagram/addStoryInteraction.js';

const xml = child => `<hierarchy><node class="android.widget.Button" content-desc="Add to story" resource-id="fixture:id/add" bounds="[10,20][110,220]" clickable="true" enabled="true">${child}</node></hierarchy>`;
const visual = '<node class="android.widget.ImageView" resource-id="fixture:id/visual" bounds="[20,30][100,200]"/>';
function fixture(successAt, child = '') {
  let state = 'STATE_HOME';
  const actions = [];
  const target = {
    elementId: 'actual-add-button', isExisting: async () => true, isDisplayed: async () => true, isEnabled: async () => true,
    getAttribute: async name => ({ class: 'android.widget.Button', 'content-desc': 'Add to story', 'resource-id': 'fixture:id/add', bounds: '[10,20][110,220]', clickable: 'true' }[name] ?? ''),
    click: async () => { actions.push('click'); if (successAt === 1) state = 'STATE_GALLERY'; },
  };
  const descendant = { isDisplayed: async () => true, isEnabled: async () => true, click: async () => { actions.push('child'); if (successAt === 2) state = 'STATE_GALLERY'; } };
  const session = {
    capabilities: { deviceUDID: 'connected-test-device' },
    getCurrentActivity: async () => '.MainActivity',
    getCurrentPackage: async () => 'com.instagram.android', getPageSource: async () => xml(child),
    saveScreenshot: async path => writeFile(path, 'mock'),
    $$: async selector => selector === '~Add to story' ? [target] : selector.includes('fixture:id/visual') ? [descendant] : [],
    $: async selector => ({ isExisting: async () => selector.includes(state === 'STATE_HOME' ? 'feed_tab' : 'gallery_grid_container'), isDisplayed: async () => true }),
    waitUntil: async (condition, options) => { if (!await condition()) throw new Error(options.timeoutMsg); },
    execute: async (command, args) => { assert.equal(command, 'mobile: clickGesture'); assert.deepEqual(args, { x: 60, y: 120 }); actions.push('gesture'); if (successAt === 3) state = 'STATE_GALLERY'; },
  };
  const options = { runAdb: async (device, args) => {
    assert.equal(device, 'connected-test-device');
    if (args.includes('dumpsys')) return { stdout: 'mCurrentFocus=Window{com.instagram.android/MainActivity}', stderr: '' };
    assert.deepEqual(args, ['shell', 'input', 'tap', '60', '120']);
    actions.push('native');
    if (successAt === 4) state = 'STATE_GALLERY';
    return { stdout: '', stderr: '' };
  } };
  return { session, actions, target, options, setState: next => { state = next; } };
}
for (const [attempt, expected, child] of [[1, ['click'], visual], [2, ['click', 'child'], visual], [3, ['click', 'gesture'], ''], [4, ['click', 'gesture', 'native'], '']]) {
  test(`Add to story confirma transição na tentativa ${attempt}, sem cliques posteriores`, async () => {
    const mock = fixture(attempt, child);
    const directory = await mkdtemp(join(tmpdir(), 'add-story-'));
    assert.equal(await openAddStory(mock.session, directory, mock.options), 'STATE_GALLERY');
    assert.deepEqual(mock.actions, expected);
    const files = await readdir(directory);
    for (const name of ['add-story-before', `add-story-click-${attempt}`]) for (const ext of ['xml', 'png', 'json']) assert.ok(files.includes(`${name}.${ext}`));
  });
}
test('Home persistente limita a quatro interações, sem repetir publicação/criação', async () => {
  const mock = fixture(0, visual);
  await assert.rejects(openAddStory(mock.session, await mkdtemp(join(tmpdir(), 'add-story-')), mock.options), /permaneceu na Home/);
  assert.deepEqual(mock.actions, ['click', 'child', 'gesture', 'native']);
});
test('descendente ambíguo é omitido e bounds são derivados da hierarquia', () => {
  assert.equal(inspectAddStoryControl(xml(visual + visual)).descendantSelector, undefined);
  assert.deepEqual(inspectAddStoryControl(xml('')).center, { x: 60, y: 120 });
  assert.throws(() => inspectAddStoryControl('<hierarchy/>'), /inequívoco/);
  assert.equal(inspectAddStoryControl(xml('').replace('[10,20][110,220]', '[10,20][10,20]')).center, undefined);
});
test('bounds divergentes cancelam gesto', async () => {
  const mock = fixture(0);
  const read = mock.target.getAttribute;
  mock.target.getAttribute = async name => name === 'bounds' ? '[0,0][20,20]' : read(name);
  await assert.rejects(openAddStory(mock.session, await mkdtemp(join(tmpdir(), 'add-story-')), mock.options), /bounds atuais não comprovados/);
  assert.deepEqual(mock.actions, ['click']);
});

test('reacquire Add to story e hierarquia após cada tentativa sem navegação', async () => {
  const mock = fixture(0, visual);
  const query = mock.session.$$;
  const source = mock.session.getPageSource;
  const events = [];
  let acquisition = 0;
  mock.session.getPageSource = async () => { events.push('hierarchy'); return source(); };
  mock.session.$$ = async selector => {
    const result = await query(selector);
    if (selector !== '~Add to story') return result;
    const generation = ++acquisition;
    events.push(`acquire-${generation}`);
    return result.map(element => ({ ...element, elementId: `fresh-${generation}`, click: async () => { events.push(`click-${generation}`); await element.click(); } }));
  };
  await assert.rejects(openAddStory(mock.session, await mkdtemp(join(tmpdir(), 'add-story-fresh-')), mock.options), /permaneceu na Home/);
  assert.equal(acquisition, 5);
  assert.ok(events.slice(events.indexOf('click-1') + 1, events.indexOf('acquire-2')).includes('hierarchy'));
  assert.ok(events.slice(events.indexOf('acquire-2') + 1, events.indexOf('acquire-3')).includes('hierarchy'));
  assert.deepEqual(mock.actions, ['click', 'child', 'gesture', 'native']);
});

test('native tap usa bounds novos depois do gesto Appium, não os da tentativa anterior', async () => {
  const mock = fixture(0);
  const originalSource = mock.session.getPageSource;
  const originalAttribute = mock.target.getAttribute;
  const originalRunner = mock.options.runAdb;
  mock.session.getPageSource = async () => (await originalSource()).replace('[10,20][110,220]', mock.actions.includes('gesture') ? '[100,200][300,400]' : '[10,20][110,220]');
  mock.target.getAttribute = async name => name === 'bounds' && mock.actions.includes('gesture') ? '[100,200][300,400]' : originalAttribute(name);
  mock.options.runAdb = async (device, args) => {
    if (args.includes('dumpsys')) return originalRunner(device, args);
    assert.equal(device, 'connected-test-device');
    assert.deepEqual(args, ['shell', 'input', 'tap', '200', '300']);
    mock.actions.push('native'); mock.setState('STATE_GALLERY');
    return { stdout: '', stderr: '' };
  };
  assert.equal(await openAddStory(mock.session, await mkdtemp(join(tmpdir(), 'fresh-native-')), mock.options), 'STATE_GALLERY');
  assert.deepEqual(mock.actions, ['click', 'gesture', 'native']);
});
test('native tap sem UDID comprovado é cancelado', async () => {
  const mock = fixture(0);
  delete mock.session.capabilities;
  await assert.rejects(openAddStory(mock.session, await mkdtemp(join(tmpdir(), 'no-udid-')), mock.options), /UDID/);
  assert.deepEqual(mock.actions, ['click', 'gesture']);
});
test('timeout do comando native tap não provoca repetição automática', async () => {
  const mock = fixture(0);
  const original = mock.options.runAdb;
  let nativeCalls = 0;
  mock.options.runAdb = async (device, args) => {
    if (args.includes('dumpsys')) return original(device, args);
    nativeCalls++;
    throw new Error('ADB input tap timeout');
  };
  const directory = await mkdtemp(join(tmpdir(), 'timeout-native-'));
  await assert.rejects(openAddStory(mock.session, directory, mock.options), /não será repetido/);
  assert.equal(nativeCalls, 1);
  assert.ok((await readdir(directory)).includes('add-story-click-4.xml'));
});
