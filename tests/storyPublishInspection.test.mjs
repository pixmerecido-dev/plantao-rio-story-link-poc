import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublishAllowed, ensureEditorWithLink, inspectPublishControls } from '../dist/instagram/storyPublishInspection.js';
import { resourceIdSelector, SHARE_SHORTCUT_ID } from '../dist/instagram/instagramStateMachine.js';
const originalDry = process.env.DRY_RUN, originalAllow = process.env.ALLOW_PUBLISH;
process.env.DRY_RUN = 'true';
after(() => {
  if (originalDry === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = originalDry;
  if (originalAllow === undefined) delete process.env.ALLOW_PUBLISH; else process.env.ALLOW_PUBLISH = originalAllow;
});
function fixture({ fallback = false, ambiguous = false } = {}) {
  const queries = [];
  const button = (label, id = '') => ({
    isExisting: async () => true, isDisplayed: async () => true, isEnabled: async () => true,
    getText: async () => label,
    getAttribute: async name => ({ 'resource-id': id, 'content-desc': label, class: 'android.widget.Button', clickable: 'true' })[name] ?? '',
    click: () => { throw new Error('Nenhum clique de publicação permitido'); },
  });
  const session = {
    $: async selector => ({ isExisting: async () => selector === resourceIdSelector('asset_button'), isDisplayed: async () => true }),
    $$: async selector => {
      queries.push(selector);
      if (selector === resourceIdSelector(SHARE_SHORTCUT_ID) && !fallback) {
        const item = button('Your story', SHARE_SHORTCUT_ID);
        return ambiguous ? [item, item] : [item];
      }
      if (selector === '~Your story' && fallback) return [button('Your story')];
      if (selector === '~Close Friends') return [button('Close Friends')];
      if (selector === '~Next') return [button('Next')];
      return [];
    },
    getCurrentPackage: async () => 'com.instagram.android',
    getPageSource: async () => '<hierarchy><node text="plantaorio.com.br" content-desc="Link sticker" class="android.view.View"/><node text="Next" class="android.widget.Button"/></hierarchy>',
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
      'content-desc': 'Your story', text: 'Your story', class: 'android.widget.Button', clickable: 'true', enabled: true,
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
