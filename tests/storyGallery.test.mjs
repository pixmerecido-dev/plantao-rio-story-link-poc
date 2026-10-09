import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFirstVisiblePhoto, waitForGalleryExit, GALLERY_ID, THUMBNAIL_ID, CAMERA_ID, FOLDER_ID } from '../dist/instagram/storyGallery.js';
import { resourceIdSelector } from '../dist/instagram/storyFlowInspection.js';

function fixture(photos, { album = 'Recents', closeAfterClick = true } = {}) {
  const clicks = [];
  let galleryVisible = true;
  const thumbnails = photos.map((photo, index) => ({
    isExisting: async () => true,
    isDisplayed: async () => photo.visible !== false,
    isEnabled: async () => true,
    getAttribute: async name => name === 'resource-id' ? (photo.id ?? THUMBNAIL_ID) : (photo.desc ?? `Photo ${index}`),
    $: async selector => { assert.equal(selector, resourceIdSelector(CAMERA_ID)); return { isExisting: async () => photo.containsCamera === true }; },
    getLocation: async () => ({ x: 0, y: photo.y ?? 100 }),
    getSize: async () => ({ width: 100, height: 100 }),
    waitForExist: async () => {},
    waitForDisplayed: async () => {},
    click: async () => { clicks.push(index); if (closeAfterClick) galleryVisible = false; },
  }));
  const gallery = {
    waitForExist: async () => {},
    waitForDisplayed: async options => { if (options.reverse) assert.equal(galleryVisible, false, 'galeria ainda aberta'); },
    isDisplayed: async () => galleryVisible,
    $$: async selector => { assert.equal(selector, resourceIdSelector(THUMBNAIL_ID)); return thumbnails; },
  };
  const session = {
    $: async selector => {
      if (selector === resourceIdSelector(GALLERY_ID)) return gallery;
      assert.equal(selector, resourceIdSelector(FOLDER_ID));
      return { waitForExist: async () => {}, waitForDisplayed: async () => {}, getText: async () => album };
    },
    waitUntil: async condition => { for (let i = 0; i < 2; i++) if (await condition()) return true; throw new Error('timeout'); },
    getWindowSize: async () => ({ width: 720, height: 1280 }),
    getCurrentPackage: async () => 'com.instagram.android',
  };
  return { session, clicks };
}

test('seleciona somente a primeira foto visível, excluindo câmera e fora da janela', async () => {
  const mock = fixture([{ id: CAMERA_ID }, { containsCamera: true }, { desc: 'Camera' }, { visible: false }, { y: 1400 }, {}, {}]);
  const result = await selectFirstVisiblePhoto(mock.session);
  assert.equal(result.thumbnailCount, 7);
  assert.deepEqual(mock.clicks, [5]);
  await waitForGalleryExit(mock.session);
});

test('uma miniatura é suficiente; clique ocorre uma única vez', async () => {
  const mock = fixture([{}]);
  await selectFirstVisiblePhoto(mock.session);
  assert.deepEqual(mock.clicks, [0]);
});

test('grade vazia falha sem acessar elemento ou clicar', async () => {
  const mock = fixture([]);
  await assert.rejects(selectFirstVisiblePhoto(mock.session), /timeout/);
  assert.deepEqual(mock.clicks, []);
});

test('somente câmera não permite selecionar', async () => {
  const mock = fixture([{ containsCamera: true }]);
  await assert.rejects(selectFirstVisiblePhoto(mock.session), /Nenhuma miniatura/);
  assert.deepEqual(mock.clicks, []);
});

test('álbum diferente de Recents interrompe sem clicar', async () => {
  const mock = fixture([{}], { album: 'Outro álbum' });
  await assert.rejects(selectFirstVisiblePhoto(mock.session), /Esperado Recents/);
  assert.deepEqual(mock.clicks, []);
});

test('galeria persistente impede confirmar editor e não causa segundo clique', async () => {
  const mock = fixture([{}, {}], { closeAfterClick: false });
  await selectFirstVisiblePhoto(mock.session);
  await assert.rejects(waitForGalleryExit(mock.session), /galeria ainda aberta/);
  assert.deepEqual(mock.clicks, [0]);
});
