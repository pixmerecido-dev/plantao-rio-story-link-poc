import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverHomeCreate, discoverStoryOption, openStoryViaCreate, HOME_PLUS_SELECTOR } from '../dist/instagram/storyCreateRoute.js';
import { openStoryFromHome } from '../dist/instagram/openStoryFromHome.js';
const previous = process.env.DRY_RUN;
process.env.DRY_RUN = 'true';
after(() => { if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous; });
const plus = '<node class="android.widget.ImageView" clickable="true" enabled="true" bounds="[0,10][90,100]"/>';
const home = `<hierarchy><node text="For you"/><node class="android.widget.Button" content-desc="Add to story" resource-id="fixture:id/add" clickable="true" enabled="true" bounds="[10,20][110,220]"/><node resource-id="com.instagram.android:id/reel_empty_badge"/><node resource-id="com.instagram.android:id/main_feed_action_bar"><node resource-id="com.instagram.android:id/action_bar_buttons_container_left">${plus}</node></node></hierarchy>`;
const known = '<hierarchy><node resource-id="com.instagram.android:id/cam_dest_story" text="STORY" class="android.widget.Button" clickable="true" enabled="true" bounds="[10,10][80,80]"/></hierarchy>';
const menu = '<hierarchy><node text="Post"/><node text="Story" class="android.widget.Button" clickable="true" enabled="true" bounds="[10,10][80,80]"/></hierarchy>';
function fixture(nextSource = known, addSucceeds = false) {
  let screen = 'home'; const clicks = [];
  const source = () => screen === 'home' ? home : screen === 'menu' ? nextSource : '<hierarchy><node resource-id="com.instagram.android:id/gallery_grid_container"/></hierarchy>';
  const element = (attrs, action) => ({ elementId: 'fresh-id', isExisting: async () => true, isDisplayed: async () => true, isEnabled: async () => true, getAttribute: async key => attrs[key] ?? '', click: async () => { clicks.push(action); if (action === 'plus') screen = 'menu'; if (action === 'story' || (action === 'add' && addSucceeds)) screen = 'gallery'; } });
  const session = {
    capabilities: { deviceUDID: 'test-device' }, getCurrentActivity: async () => '.MainActivity', getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => source(), saveScreenshot: async path => writeFile(path, 'mock'),
    $: async selector => ({ isExisting: async () => (screen === 'home' && selector.includes('feed_tab')) || (screen === 'gallery' && selector.includes('gallery_grid_container')) || (screen === 'menu' && nextSource === known && selector.includes('cam_dest_story')), isDisplayed: async () => true }),
    $$: async selector => {
      if (selector === '~Add to story' && screen === 'home') return [element({ class: 'android.widget.Button', 'content-desc': 'Add to story', 'resource-id': 'fixture:id/add', clickable: 'true', bounds: '[10,20][110,220]' }, 'add')];
      if (selector === HOME_PLUS_SELECTOR && screen === 'home') return [element({ class: 'android.widget.ImageView', clickable: 'true', bounds: '[0,10][90,100]' }, 'plus')];
      if (screen === 'menu' && (selector.includes('cam_dest_story') || selector.includes('.text("Story")'))) return [element({ class: 'android.widget.Button', text: nextSource === known ? 'STORY' : 'Story', clickable: 'true', bounds: '[10,10][80,80]' }, 'story')];
      return [];
    },
    waitUntil: async (condition, options) => { if (!await condition()) throw new Error(options.timeoutMsg); },
    execute: async () => { clicks.push('gesture'); },
  };
  const runAdb = async (_, args) => { if (args.includes('tap')) clicks.push('native'); return { stdout: '', stderr: '' }; };
  return { driver: { getSession: () => session }, clicks, runAdb };
}
test('combinação contextual observada identifica + sem coordenadas', () => {
  assert.equal(discoverHomeCreate(home).selector, HOME_PLUS_SELECTOR);
  assert.throws(() => discoverHomeCreate(home.replace(plus, plus + plus)), /inequivocamente/);
});
test('Story exige menu real ou resource-id confirmado; ambiguidades abortam', () => {
  assert.ok(discoverStoryOption(known).selector.includes('cam_dest_story'));
  assert.equal(discoverStoryOption(menu).selector, 'android=new UiSelector().text("Story")');
  assert.throws(() => discoverStoryOption('<hierarchy><node text="Story" clickable="true"/></hierarchy>'), /não comprovado/);
  assert.throws(() => discoverStoryOption(menu.replace('</hierarchy>', '<node text="Story" clickable="true"/></hierarchy>')), /ambígua/);
});
for (const [name, source] of [['aba confirmada', known], ['menu observado em runtime', menu]]) test(`Create -> Story -> galeria: ${name}`, async () => {
  const mock = fixture(source), directory = await mkdtemp(join(tmpdir(), 'create-route-'));
  assert.equal(await openStoryViaCreate(mock.driver, directory), 'STATE_GALLERY');
  assert.deepEqual(mock.clicks, ['plus', 'story']);
  const files = await readdir(directory);
  for (const stage of ['create-route-home', 'create-route-after-plus', 'create-route-gallery']) for (const ext of ['xml', 'png', 'json']) assert.ok(files.includes(`${stage}.${ext}`));
});
test('menu diferente captura diagnóstico e não tenta adivinhar Story', async () => {
  const mock = fixture('<hierarchy><node text="Settings"/></hierarchy>'), directory = await mkdtemp(join(tmpdir(), 'create-fail-'));
  await assert.rejects(openStoryViaCreate(mock.driver, directory), /Menu Story não apareceu/);
  assert.deepEqual(mock.clicks, ['plus']);
  const files = await readdir(directory);
  for (const ext of ['xml', 'png', 'json']) assert.ok(files.includes(`create-route-after-plus.${ext}`));
});
test('rota Add funciona primeiro e nunca abre + quando há sucesso', async () => {
  const mock = fixture(known, true);
  assert.equal(await openStoryFromHome(mock.driver, await mkdtemp(join(tmpdir(), 'create-first-')), { runAdb: mock.runAdb }), 'STATE_GALLERY');
  assert.deepEqual(mock.clicks, ['add']);
});
test('fallback + só ocorre após esgotar Add e comprovar Home novamente', async () => {
  const mock = fixture();
  assert.equal(await openStoryFromHome(mock.driver, await mkdtemp(join(tmpdir(), 'create-fallback-')), { runAdb: mock.runAdb }), 'STATE_GALLERY');
  assert.deepEqual(mock.clicks, ['add', 'gesture', 'native', 'plus', 'story']);
});

const camera = '<hierarchy><node resource-id="com.instagram.android:id/cam_dest_story" text="STORY" selected="true"/><node text="Allow Instagram to access your camera and microphone"/><node text="Open Settings" clickable="true"/><node content-desc="Gallery" class="android.widget.Button" clickable="true" enabled="true" bounds="[10,10][80,80]"/></hierarchy>';
test('Story abre câmera e depois galeria sem tocar Open Settings', async () => {
  const mock = fixture();
  const session = mock.driver.getSession(), read = session.getPageSource, find = session.$$, probe = session.$;
  let inCamera = false, inGallery = false;
  session.getPageSource = async () => inGallery ? '<hierarchy><node resource-id="com.instagram.android:id/gallery_grid_container"/></hierarchy>' : inCamera ? camera : read();
  session.$ = async selector => inCamera || inGallery ? { isExisting: async () => selector.includes(inGallery ? 'gallery_grid_container' : 'cam_dest_story'), isDisplayed: async () => true } : probe(selector);
  session.$$ = async selector => {
    if (selector === '~Gallery' && inCamera) return [{ isExisting: async () => true, isDisplayed: async () => true, isEnabled: async () => true,
      getAttribute: async key => ({ class: 'android.widget.Button', 'content-desc': 'Gallery', bounds: '[10,10][80,80]', clickable: 'true' }[key] ?? ''), click: async () => { mock.clicks.push('gallery'); inCamera = false; inGallery = true; } }];
    const elements = await find(selector);
    if (selector.includes('cam_dest_story')) for (const item of elements) item.click = async () => { mock.clicks.push('story'); inCamera = true; };
    return elements;
  };
  const directory = await mkdtemp(join(tmpdir(), 'story-camera-'));
  assert.equal(await openStoryViaCreate(mock.driver, directory), 'STATE_GALLERY');
  assert.deepEqual(mock.clicks, ['plus', 'story', 'gallery']);
  const files = await readdir(directory);
  for (const ext of ['xml', 'png', 'json']) assert.ok(files.includes(`create-route-story-camera.${ext}`));
});
test('galeria da câmera desconhecida ou ambígua aborta sem adivinhar coordenadas', async () => {
  const { discoverCameraGallery } = await import('../dist/instagram/storyCreateRoute.js');
  const { isStoryCameraHierarchy } = await import('../dist/instagram/storyCameraState.js');
  assert.equal(isStoryCameraHierarchy(camera), true);
  assert.equal(isStoryCameraHierarchy(camera.replace('selected="true"', 'selected="false"')), false);
  assert.equal(isStoryCameraHierarchy('<hierarchy><node resource-id="com.instagram.android:id/bottom_sheet_camera_container"/></hierarchy>'), false);
  assert.throws(() => discoverCameraGallery(camera.replace('content-desc="Gallery"', 'content-desc=""')), /não identificado/);
  assert.throws(() => discoverCameraGallery(camera.replace('</hierarchy>', '<node content-desc="Gallery" clickable="true"/></hierarchy>')), /inequivocamente/);
});
