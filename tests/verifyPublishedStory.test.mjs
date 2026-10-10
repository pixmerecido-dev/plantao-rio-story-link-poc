import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPublishedStory, draftFingerprint } from '../dist/instagram/verifyPublishedStory.js';
const xml = text => `<hierarchy><node text="${text}" class="android.widget.TextView"/></hierarchy>`;
const observe = (text, state = 'STATE_HOME', elapsed_ms = 500) => ({ source: xml(text), state, elapsed_ms });
test('Home e Story antigo nunca comprovam publicação desta tarefa', () => {
  const result = verifyPublishedStory(xml('editor'), [observe("pixmerecido's story, 0 of 6, Unseen.")]);
  assert.equal(result.outcome, 'INCONCLUSIVE');
  assert.equal(result.content_identity_verified, false);
});
test('novo anel, identificador ou mensagem de upload não é confirmação', () => {
  const result = verifyPublishedStory(xml('editor'), [observe('Uploading'), { ...observe('after'), source: '<hierarchy><node resource-id="fixture:id/new_story_ring"/></hierarchy>' }]);
  assert.equal(result.outcome, 'INCONCLUSIVE');
  assert.ok(result.evidence.some(item => item.kind === 'upload-pending'));
  assert.ok(result.evidence.some(item => item.kind === 'unverified-new-ui-identifier'));
});
test('mensagem específica nova de envio do Story confirma esta tentativa', () => {
  const result = verifyPublishedStory(xml('editor'), [observe('Uploading'), observe('Your story has been shared.', 'STATE_HOME', 5500)]);
  assert.equal(result.outcome, 'SUCCESS');
  assert.ok(result.evidence.some(item => item.kind === 'new-story-send-acknowledgement'));
});
test('mensagem existente antes do clique não confirma novo envio', () => {
  assert.equal(verifyPublishedStory(xml('Story shared'), [observe('Story shared')]).outcome, 'INCONCLUSIVE');
});
test('mensagem genérica de sucesso não é evidência de Story enviado', () => {
  assert.equal(verifyPublishedStory(xml('editor'), [observe('Success')]).outcome, 'INCONCLUSIVE');
});
test('erro de envio explícito gera FAILURE sem retentativa', () => {
  const result = verifyPublishedStory(xml('editor'), [observe('Failed to upload')]);
  assert.equal(result.outcome, 'FAILURE'); assert.equal(result.retryAllowed, false);
});
test('confirmação e falha contraditórias são inconclusivas', () => {
  assert.equal(verifyPublishedStory(xml('editor'), [observe('Story shared'), observe('Failed to upload')]).outcome, 'INCONCLUSIVE');
});
test('timeout, observação inválida ou nenhuma observação são inconclusivos', () => {
  for (const observations of [[], [{ ...observe('Story shared'), error: 'timeout' }], [{ ...observe(''), source: '<broken>' }]]) {
    assert.equal(verifyPublishedStory(xml('editor'), observations).outcome, 'INCONCLUSIVE');
  }
});
test('fingerprint do rascunho é estável, varia com fonte e não se passa por hash da mídia', () => {
  assert.equal(draftFingerprint(xml('a')), draftFingerprint(xml('a')));
  assert.notEqual(draftFingerprint(xml('a')), draftFingerprint(xml('b')));
});
