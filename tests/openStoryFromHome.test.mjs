import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStoryFromHome, injectMediaAndOpenStory } from '../dist/instagram/openStoryFromHome.js';
import { waitForIndexedMedia } from '../dist/instagram/mediaScan.js';

const previous = process.env.DRY_RUN;
process.env.DRY_RUN = 'true';
after(() => { if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous; });
const home = '<hierarchy><node text="For you"/><node class="android.widget.Button" resource-id="fixture:id/add" content-desc="Add to story" clickable="true" bounds="[10,20][110,220]"/><node resource-id="com.instagram.android:id/reel_empty_badge"/></hierarchy>';
function fixture({ failHomeAfterMedia = false } = {}) {
  const events = [];
  let state = 'STATE_HOME', scanned = false;
  const session = {
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => { events.push('hierarchy'); return state === 'STATE_HOME' ? home : '<hierarchy><node resource-id="com.instagram.android:id/gallery_grid_container"/></hierarchy>'; },
    saveScreenshot: async path => writeFile(path, 'mock'),
    pause: async ms => { assert.equal(ms, 2000); assert.equal(scanned, true); events.push('stabilized'); if (failHomeAfterMedia) state = 'STATE_GALLERY'; },
    $: async selector => ({ isExisting: async () => selector.includes(state === 'STATE_HOME' ? 'feed_tab' : 'gallery_grid_container'), isDisplayed: async () => true }),
    $$: async selector => {
      if (selector !== '~Add to story') return [];
      events.push('fresh-button');
      return [{ elementId: scanned ? 'post-media-id' : 'no-media-id', isExisting: async () => true, isDisplayed: async () => true, isEnabled: async () => true,
        getAttribute: async name => ({ class: 'android.widget.Button', 'content-desc': 'Add to story', clickable: 'true', 'resource-id': 'fixture:id/add', bounds: '[10,20][110,220]' }[name] ?? ''),
        click: async () => { events.push('click'); state = 'STATE_GALLERY'; },
      }];
    },
    waitUntil: async (condition, options) => { if (!await condition()) throw new Error(options.timeoutMsg); },
  };
  return { driver: { getSession: () => session }, events, publisher: { prepareImage: async image => { assert.equal(image, 'received.jpg'); events.push('push'); events.push('indexed'); scanned = true; return 'new-job.jpg'; } } };
}
test('abertura com e sem mídia usa a mesma navegação e só termina em galeria', async () => {
  const normal = fixture(), media = fixture();
  assert.equal(await openStoryFromHome(normal.driver, await mkdtemp(join(tmpdir(), 'open-story-'))), 'STATE_GALLERY');
  const directory = await mkdtemp(join(tmpdir(), 'open-media-'));
  assert.deepEqual(await injectMediaAndOpenStory(media.driver, media.publisher, 'received.jpg', directory), { filename: 'new-job.jpg', state: 'STATE_GALLERY' });
  assert.deepEqual(normal.events.filter(event => ['fresh-button', 'click'].includes(event)), media.events.filter(event => ['fresh-button', 'click'].includes(event)));
  assert.ok(media.events.indexOf('indexed') < media.events.indexOf('stabilized'));
  assert.ok(media.events.indexOf('stabilized') < media.events.indexOf('fresh-button'));
  assert.ok(media.events.slice(media.events.indexOf('stabilized') + 1, media.events.indexOf('fresh-button')).includes('hierarchy'));
  const files = await readdir(directory);
  for (const ext of ['xml', 'png', 'json']) assert.ok(files.includes(`media-home-stabilized.${ext}`));
});
test('Home perdida durante estabilização cancela clique após mídia', async () => {
  const mock = fixture({ failHomeAfterMedia: true });
  await assert.rejects(injectMediaAndOpenStory(mock.driver, mock.publisher, 'received.jpg', await mkdtemp(join(tmpdir(), 'open-media-'))), /STATE_HOME real/);
  assert.ok(!mock.events.includes('fresh-button'));
  assert.ok(!mock.events.includes('click'));
});
test('falha do scan impede estabilização/abertura', async () => {
  const mock = fixture();
  mock.publisher.prepareImage = async () => { throw new Error('scan não concluído'); };
  await assert.rejects(injectMediaAndOpenStory(mock.driver, mock.publisher, 'received.jpg', await mkdtemp(join(tmpdir(), 'open-media-'))), /scan não concluído/);
  assert.ok(!mock.events.includes('click'));
  assert.ok(!mock.events.includes('stabilized'));
});
test('MediaStore só confirma o arquivo exato desta tarefa, depois do processamento', async () => {
  const destination = '/sdcard/Pictures/PlantaoRio/plantao-story-123.jpg';
  let queries = 0, pauses = 0;
  const outputs = ['No result found.', 'Row: 0 _id=9, _data=/sdcard/Pictures/PlantaoRio/plantao-story-122.jpg', `Row: 0 _id=10, _data=${destination}`];
  await waitForIndexedMedia(destination, async () => outputs[queries++], async () => { pauses++; });
  assert.equal(queries, 3); assert.equal(pauses, 2);
});
test('timeout de indexação aborta sem assumir que fim do broadcast é scan concluído', async () => {
  let queries = 0, pauses = 0;
  await assert.rejects(waitForIndexedMedia('/sdcard/Pictures/PlantaoRio/current.jpg', async () => { queries++; return 'Broadcast completed: result=0'; }, async () => { pauses++; }), /MediaStore não confirmou/);
  assert.equal(queries, 20); assert.equal(pauses, 19);
});
test('estado inicial residual impede injeção de mídia e abertura', async () => {
  const mock = fixture();
  mock.driver.getSession().getPageSource = async () => '<hierarchy><node resource-id="asset_button"/></hierarchy>';
  await assert.rejects(injectMediaAndOpenStory(mock.driver, mock.publisher, 'received.jpg', await mkdtemp(join(tmpdir(), 'open-media-'))), /STATE_HOME/);
  assert.ok(!mock.events.includes('push'));
  assert.ok(!mock.events.includes('click'));
});
