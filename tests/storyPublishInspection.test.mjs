import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublishAllowed, ensureEditorWithLink, inspectPublishControls, detectPublishReadyState, LINK_STICKER_HOLDER_ID } from '../dist/instagram/storyPublishInspection.js';
import { fillStoryLinkUrl } from '../dist/instagram/storyLinkFill.js';
import { applyStoryLink } from '../dist/instagram/storyLinkApply.js';
import { resourceIdSelector, SHARE_SHORTCUT_ID } from '../dist/instagram/instagramStateMachine.js';
const originalDry = process.env.DRY_RUN, originalAllow = process.env.ALLOW_PUBLISH;
process.env.DRY_RUN = 'true';
after(() => {
  if (originalDry === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = originalDry;
  if (originalAllow === undefined) delete process.env.ALLOW_PUBLISH; else process.env.ALLOW_PUBLISH = originalAllow;
});
function fixture({ fallback = false, ambiguous = false, holder = false, holderDisplayed = true, publication = true, domain = true, editor = true } = {}) {
  const queries = [];
  const button = (label, id = '') => ({
    isExisting: async () => true, isDisplayed: async () => true, isEnabled: async () => true,
    getText: async () => label,
    getAttribute: async name => ({ 'resource-id': id, 'content-desc': label, class: 'android.widget.Button', clickable: 'true' })[name] ?? '',
    click: () => { throw new Error('Nenhum clique de publicação permitido'); },
  });
  const session = {
    $: async selector => ({ isExisting: async () => editor && selector === resourceIdSelector('asset_button'), isDisplayed: async () => true }),
    $$: async selector => {
      queries.push(selector);
      if (selector === resourceIdSelector(LINK_STICKER_HOLDER_ID)) return holder ? [{ ...button('', LINK_STICKER_HOLDER_ID), isDisplayed: async () => holderDisplayed }] : [];
      if (selector === resourceIdSelector(SHARE_SHORTCUT_ID) && !fallback && publication) {
        const item = button('Your story', SHARE_SHORTCUT_ID);
        return ambiguous ? [item, item] : [item];
      }
      if (selector === '~Your story' && fallback && publication) return [button('Your story')];
      if (selector === '~Close Friends') return [button('Close Friends')];
      if (selector === '~Next') return [button('Next')];
      return [];
    },
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => domain ? '<hierarchy><node text="plantaorio.com.br" content-desc="Link sticker" class="android.view.View"/><node text="Next" class="android.widget.Button"/></hierarchy>' : '<hierarchy/>',
  };
  return { session, queries };
}
for (const value of [undefined, 'false', 'TRUE', '1', '', ' true ']) {
  test(`trava bloqueia ALLOW_PUBLISH=${String(value)}`, () => {
    if (value === undefined) delete process.env.ALLOW_PUBLISH; else process.env.ALLOW_PUBLISH = value;
    assert.throws(() => assertPublishAllowed(), /ALLOW_PUBLISH=true/);
  });
}
test('trava exige valor true exato', () => assert.doesNotThrow(() => assertPublishAllowed('true')));
for (const value of ['false', 'true']) {
  test(`inspeção com ALLOW_PUBLISH=${value} nunca clica e registra todos os atributos`, async () => {
    process.env.ALLOW_PUBLISH = value;
    const { session } = fixture();
    const result = await inspectPublishControls(session);
    assert.equal(result.published, false);
    assert.equal(result.allowPublish, value === 'true');
    assert.deepEqual(result.yourStory, {
      selector: resourceIdSelector(SHARE_SHORTCUT_ID), 'resource-id': SHARE_SHORTCUT_ID,
      'content-desc': 'Your story', text: 'Your story', class: 'android.widget.Button', clickable: 'true', enabled: true, displayed: true,
    });
    assert.equal(result.otherControls.length, 2);
  });
}
test('fallback Your story usa accessibility id sem XPath', async () => {
  const mock = fixture({ fallback: true });
  assert.equal((await inspectPublishControls(mock.session)).yourStory.selector, '~Your story');
  assert.ok(mock.queries.every(selector => !selector.startsWith('//')));
});
test('Your story ambíguo aborta sem escolher índice', async () => {
  await assert.rejects(inspectPublishControls(fixture({ ambiguous: true }).session), /ambíguo/);
});
test('editor final com domínio e link evidenciado é retomado sem duplicar sticker', async () => {
  const mock = fixture();
  const result = await ensureEditorWithLink(mock.session, 'https://plantaorio.com.br/', () => { throw new Error('não selecionar imagem'); });
  assert.equal(result.state, 'STATE_EDITOR_WITH_LINK');
  assert.equal(result.confirmedBy, 'editor-hierarchy-domain');
});

test('holder real e controles finais retomam editor sem URL no XML e sem qualquer clique', async () => {
  const mock = fixture({ holder: true, domain: false });
  const result = await ensureEditorWithLink(mock.session, 'https://plantaorio.com.br/', () => { throw new Error('fluxo de imagem não deve ser chamado'); });
  assert.equal(result.state, 'STATE_EDITOR_WITH_LINK');
  assert.equal(result.confirmedBy, 'editor-sticker-holder-and-publish-controls');
  const controls = await inspectPublishControls(mock.session);
  assert.equal(controls.published, false);
  assert.ok(mock.queries.includes(resourceIdSelector(LINK_STICKER_HOLDER_ID)));
  assert.ok(mock.queries.includes(resourceIdSelector(SHARE_SHORTCUT_ID)));
});
test('detecção do editor com link aceita controles por accessibility id', async () => {
  assert.equal(await detectPublishReadyState(fixture({ holder: true, domain: false, fallback: true }).session), 'STATE_EDITOR_WITH_LINK');
});
for (const options of [{ holder: false }, { holder: true, holderDisplayed: false }, { holder: true, publication: false }]) {
  test(`combinação incompleta não confirma editor com link: ${JSON.stringify(options)}`, async () => {
    assert.equal(await detectPublishReadyState(fixture(options).session), 'STATE_EDITOR');
  });
}
test('holder e controles sem editor ativo não confirmam estado final', async () => {
  assert.equal(await detectPublishReadyState(fixture({ holder: true, editor: false }).session), 'STATE_UNKNOWN');
});

test('aplicar link no editor final tem sucesso idempotente sem navegar, preencher ou clicar', async () => {
  const mock = fixture({ holder: true, domain: false });
  assert.equal(await applyStoryLink(mock.session, 'https://example.org/new-url', () => { throw new Error('não preparar imagem'); }), 'https://example.org/new-url');
  // Fakes não oferecem mutações de campo ou cliques de editor: qualquer reentrada falharia.
  assert.equal(await detectPublishReadyState(mock.session), 'STATE_EDITOR_WITH_LINK');
});

test('fill não entra na navegação de link quando o sticker já está aplicado', async () => {
  const mock = fixture({ holder: true, domain: false });
  await assert.rejects(fillStoryLinkUrl(mock.session, 'https://plantaorio.com.br/', () => { throw new Error('não preparar'); }), /Link já aplicado/);
});
