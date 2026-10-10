import test from 'node:test';
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
    getCurrentPackage: async () => 'com.instagram.android', getPageSource: async () => xml(child),
    saveScreenshot: async path => writeFile(path, 'mock'),
    $$: async selector => selector === '~Add to story' ? [target] : selector.includes('fixture:id/visual') ? [descendant] : [],
    $: async selector => ({ isExisting: async () => selector.includes(state === 'STATE_HOME' ? 'feed_tab' : 'gallery_grid_container'), isDisplayed: async () => true }),
    waitUntil: async (condition, options) => { if (!await condition()) throw new Error(options.timeoutMsg); },
    execute: async (command, args) => { assert.equal(command, 'mobile: clickGesture'); assert.deepEqual(args, { x: 60, y: 120 }); actions.push('gesture'); if (successAt === 3) state = 'STATE_GALLERY'; },
  };
  return { session, actions, target };
}
for (const [attempt, expected, child] of [[1, ['click'], visual], [2, ['click', 'child'], visual], [3, ['click', 'gesture'], '']]) {
  test(`Add to story confirma transição na tentativa ${attempt}, sem cliques posteriores`, async () => {
    const mock = fixture(attempt, child);
    const directory = await mkdtemp(join(tmpdir(), 'add-story-'));
    assert.equal(await openAddStory(mock.session, directory), 'STATE_GALLERY');
    assert.deepEqual(mock.actions, expected);
    const files = await readdir(directory);
    for (const name of ['add-story-before', `add-story-click-${attempt}`]) for (const ext of ['xml', 'png', 'json']) assert.ok(files.includes(`${name}.${ext}`));
  });
}
test('Home persistente limita a três interações, sem repetir publicação/criação', async () => {
  const mock = fixture(0, visual);
  await assert.rejects(openAddStory(mock.session, await mkdtemp(join(tmpdir(), 'add-story-'))), /permaneceu na Home/);
  assert.deepEqual(mock.actions, ['click', 'child', 'gesture']);
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
  await assert.rejects(openAddStory(mock.session, await mkdtemp(join(tmpdir(), 'add-story-'))), /bounds atuais não comprovados/);
  assert.deepEqual(mock.actions, ['click']);
});
