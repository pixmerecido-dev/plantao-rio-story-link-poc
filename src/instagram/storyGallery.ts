import type { InstagramDriver } from './InstagramDriver.js';
import { resourceIdSelector } from './storyFlowInspection.js';

type Session = ReturnType<InstagramDriver['getSession']>;
export const GALLERY_ID = 'com.instagram.android:id/gallery_grid_container';
export const THUMBNAIL_ID = 'com.instagram.android:id/gallery_grid_item_thumbnail';
export const CAMERA_ID = 'com.instagram.android:id/gallery_grid_camera_item_icon';
export const FOLDER_ID = 'com.instagram.android:id/gallery_folder_menu_tv';
export const GALLERY_WAIT = { timeout: 20_000, interval: 500 };

export async function waitForGallery(session: Session): Promise<void> {
  const gallery = await session.$(resourceIdSelector(GALLERY_ID));
  await gallery.waitForExist(GALLERY_WAIT);
  await gallery.waitForDisplayed(GALLERY_WAIT);
}

export async function selectFirstVisiblePhoto(session: Session) {
  await waitForGallery(session);
  // A premissa "mais recente primeiro" só é usada no álbum observado Recents.
  const folder = await session.$(resourceIdSelector(FOLDER_ID));
  await folder.waitForExist(GALLERY_WAIT);
  await folder.waitForDisplayed(GALLERY_WAIT);
  const album = (await folder.getText()).trim();
  if (album !== 'Recents') throw new Error(`Álbum atual: ${album}. Esperado Recents; nenhuma imagem selecionada.`);
  const gallery = await session.$(resourceIdSelector(GALLERY_ID));
  await session.waitUntil(async () => (await gallery.$$(resourceIdSelector(THUMBNAIL_ID))).length > 0,
    { ...GALLERY_WAIT, timeoutMsg: 'Nenhuma miniatura de foto apareceu na galeria.' });
  const thumbnails = await gallery.$$(resourceIdSelector(THUMBNAIL_ID));
  const count = thumbnails.length;
  console.log(`[3] Miniaturas encontradas: ${count}`);
  if (count === 0) throw new Error('A grade ficou vazia; nenhuma imagem selecionada.');
  const viewport = await session.getWindowSize();
  // Itera na ordem da grade, sem acessar posição de uma coleção vazia.
  for (const thumbnail of thumbnails) {
    if (!(await thumbnail.isExisting()) || !(await thumbnail.isDisplayed()) || !(await thumbnail.isEnabled())) continue;
    const id = await thumbnail.getAttribute('resource-id');
    const description = await thumbnail.getAttribute('content-desc');
    if (id === CAMERA_ID || id !== THUMBNAIL_ID || /\b(camera|câmera)\b/i.test(description ?? '')) continue;
    // Exclui também eventual item que contenha o ícone confirmado da câmera.
    const camera = await thumbnail.$(resourceIdSelector(CAMERA_ID));
    if (await camera.isExisting()) continue;
    const location = await thumbnail.getLocation();
    const size = await thumbnail.getSize();
    // Geometria dinâmica só para validar visibilidade; o clique é no elemento.
    if (size.width <= 0 || size.height <= 0 || location.x < 0 || location.y < 0 ||
        location.x + size.width > viewport.width || location.y + size.height > viewport.height) continue;
    await thumbnail.waitForExist(GALLERY_WAIT);
    await thumbnail.waitForDisplayed(GALLERY_WAIT);
    if (!(await gallery.isDisplayed()) || !(await thumbnail.isEnabled()) ||
        await thumbnail.getAttribute('resource-id') !== THUMBNAIL_ID) throw new Error('Grade/miniatura mudou antes do clique.');
    if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
    console.log(`Antes do clique: resource-id=${id}; content-desc=${JSON.stringify(description)}; quantidade=${count}`);
    await thumbnail.click();
    // Retorna imediatamente: nunca tenta outra foto após um clique.
    return { resourceId: id, contentDescription: description, thumbnailCount: count, album,
      selectionPolicy: 'primeira foto visível em Recents; imagem de teste é a mais recente por premissa da POC' };
  }
  throw new Error('Nenhuma miniatura de foto realmente visível foi encontrada; câmera não será usada.');
}

export async function waitForGalleryExit(session: Session): Promise<void> {
  const gallery = await session.$(resourceIdSelector(GALLERY_ID));
  await gallery.waitForDisplayed({ ...GALLERY_WAIT, reverse: true });
  await session.waitUntil(async () => {
    const currentGallery = await session.$(resourceIdSelector(GALLERY_ID));
    return !(await currentGallery.isDisplayed()) && await session.getCurrentPackage() === 'com.instagram.android';
  }, { ...GALLERY_WAIT, timeoutMsg: 'A galeria não fechou dentro do Instagram após selecionar a imagem.' });
}
