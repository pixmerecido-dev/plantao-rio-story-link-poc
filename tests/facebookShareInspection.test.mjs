import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectFacebookShare } from '../dist/instagram/facebookShareInspection.js';
const source = children => `<hierarchy><node class="android.view.ViewGroup">${children}</node></hierarchy>`;
const label = '<node text="And Facebook Story" class="android.widget.TextView"/>';
const toggle = checked => `<node resource-id="fixture:id/facebook_toggle" class="android.widget.Switch" checked="${checked}" selected="false" enabled="true" clickable="true"/>`;
test('Your story e And Facebook Story sem controle indicam disponível mas estado desconhecido', () => {
  const result = inspectFacebookShare(source('<node text="Your story" class="android.widget.Button" selected="true"/>' + label));
  assert.equal(result.facebook_story_available, true);
  assert.equal(result.facebook_story_enabled, false);
  assert.equal(result.facebook_story_state_known, false);
  assert.equal(result.facebook_story_status, 'unknown');
});
for (const checked of ['true', 'false']) {
  test(`toggle irmão em linha exclusivamente Facebook registra checked=${checked}`, () => {
    const result = inspectFacebookShare(source(label + toggle(checked)));
    assert.equal(result.facebook_story_state_known, true);
    assert.equal(result.facebook_story_enabled, checked === 'true');
    const element = result.observed.find(item => item['resource-id'] === 'fixture:id/facebook_toggle');
    assert.equal(element.checked, checked); assert.equal(element.enabled, 'true'); assert.equal(element.clickable, 'true');
    assert.equal(element.selector, 'android=new UiSelector().resourceId("fixture:id/facebook_toggle")');
  });
}
test('checkbox dentro do bloco Facebook confirma estado real', () => {
  const result = inspectFacebookShare(source('<node content-desc="Facebook Story" class="android.view.ViewGroup"><node class="android.widget.CheckBox" checked="true" enabled="false"/></node>'));
  assert.equal(result.facebook_story_enabled, true);
  assert.equal(result.observed.find(item => item.class === 'android.widget.CheckBox').enabled, 'false');
});
test('botão exclusivamente Facebook selecionado expõe estado sem confundir checked falso padrão', () => {
  const result = inspectFacebookShare(source('<node text="Facebook Story" class="android.widget.Button" checked="false" selected="true"/>'));
  assert.equal(result.facebook_story_enabled, true);
});
test('TextView selecionado e botão compartilhado Your story não comprovam Facebook ativo', () => {
  for (const node of ['<node text="Facebook Story" class="android.widget.TextView" selected="true"/>', '<node content-desc="Your story And Facebook Story" class="android.widget.Button" selected="true"/>']) {
    const result = inspectFacebookShare(source(node));
    assert.equal(result.facebook_story_available, true); assert.equal(result.facebook_story_state_known, false);
  }
});
test('toggle de outra conta ou bloco não é associado só pela proximidade', () => {
  const result = inspectFacebookShare(source(label + toggle('true') + '<node text="Other account"/>'));
  assert.equal(result.facebook_story_state_known, false);
});
test('Facebook ausente ou oculto retorna false sem presumir desativação confirmada', () => {
  for (const input of [source('<node text="Your story"/>'), source('<node text="Facebook Story" displayed="false"/>')]) {
    const result = inspectFacebookShare(input);
    assert.equal(result.facebook_story_available, false); assert.equal(result.facebook_story_enabled, false); assert.equal(result.facebook_story_state_known, false);
  }
});
test('controles Facebook contraditórios são registrados como ambíguos', () => {
  const result = inspectFacebookShare(source('<node content-desc="Facebook Story" class="android.view.ViewGroup">' + toggle('true') + toggle('false') + '</node>'));
  assert.equal(result.facebook_story_status, 'ambiguous'); assert.equal(result.facebook_story_enabled, false);
});
test('XML inválido e entidades são recusados', () => {
  assert.throws(() => inspectFacebookShare('<hierarchy>'), /inválida/);
  assert.throws(() => inspectFacebookShare('<!DOCTYPE hierarchy><hierarchy/>'), /DTD/);
});

test('bloco ancestral oculto não oferece compartilhamento ativo', () => {
  const result = inspectFacebookShare('<hierarchy><node displayed="false"><node text="Facebook Story" class="android.widget.Switch" checked="true"/></node></hierarchy>');
  assert.equal(result.facebook_story_available, false);
  assert.equal(result.facebook_story_enabled, false);
});
