import test from 'node:test';
import assert from 'node:assert/strict';
import { isNamedMedia, isUnsafeMediaControl, observedImageCandidates, selectorForObservedElement } from '../dist/instagram/storyMediaInspection.js';
const element = (text = '', desc = '', id = '', cls = 'android.widget.ImageView') => ({ text, 'content-desc': desc, 'resource-id': id, class: cls });

test('nome completo ou caminho identifica a imagem; substring não identifica', () => {
  const filename = 'plantao-story-123.jpg';
  assert.ok(isNamedMedia(element(filename), filename));
  assert.ok(isNamedMedia(element('', `/sdcard/Pictures/PlantaoRio/${filename}`), filename));
  assert.ok(isNamedMedia(element('', `Photo, ${filename}`), filename));
  assert.equal(isNamedMedia(element(`other-${filename}`), filename), false);
  assert.equal(isNamedMedia(element('plantao-story-1234.jpg'), filename), false);
});

test('seletor composto preserva somente atributos reais e escapa strings', () => {
  assert.equal(selectorForObservedElement(element('a"b', 'Photo', 'fixture:id/thumb')),
    'android=new UiSelector().resourceId("fixture:id/thumb").description("Photo").text("a\\"b").className("android.widget.ImageView")');
  assert.equal(selectorForObservedElement(element()), undefined);
});

test('não oferece botões de compartilhar, link ou stickers como mídia', () => {
  for (const label of ['Share', 'Send', 'Compartilhar', 'Publicar', 'Link', 'Stickers']) {
    assert.ok(isUnsafeMediaControl(element('', label)));
    assert.equal(observedImageCandidates([element('', label)]).length, 0);
  }
  assert.ok(isUnsafeMediaControl(element('', '', 'fixture:id/share_button')));
});

test('miniaturas sem identidade são descartadas; seletores repetidos são deduplicados', () => {
  const photo = element('', 'Photo fixture');
  assert.deepEqual(observedImageCandidates([element(), photo, photo, element('Story', '', '', 'android.widget.TextView')]), [photo]);
});
