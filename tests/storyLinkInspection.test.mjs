import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { clickExactLinkSticker, inspectLinkEditorElements, waitForLinkEditor, LINK_ITEM_SELECTOR, LINK_ACCESSIBILITY_SELECTOR } from '../dist/instagram/storyLinkInspection.js';
import { STICKER_ITEM_ID, resourceIdSelector } from '../dist/instagram/instagramStateMachine.js';
const originalDryRun = process.env.DRY_RUN;
process.env.DRY_RUN = 'true';
after(() => { if (originalDryRun === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = originalDryRun; });

function fixture(descriptions, { transition = true, after = 1, hidden = false, enabled = true, gestureError = false, clickError = false, descendants = 0 } = {}) {
  const clicks = [], gestures = [], elementClicks = [];
  let panel = true;
  const items = descriptions.map(description => ({
    elementId: `real-${description}`,
    $$: async selector => {
      assert.equal(selector, 'android=new UiSelector().className("android.widget.ImageView")');
      return Array.from({ length: descendants }, (_, index) => ({ elementId: `visual-${index}`, isExisting: async () => true, isDisplayed: async () => true, isEnabled: async () => true }));
    },
    isExisting: async () => panel,
    isDisplayed: async () => panel && !hidden,
    isEnabled: async () => enabled,
    getText: async () => '',
    getAttribute: async name => name === 'content-desc' ? description : STICKER_ITEM_ID,
    waitForExist: async () => { throw new Error('StrictSelectorError: não esperar item por selector compartilhado'); },
    waitForDisplayed: async () => { throw new Error('StrictSelectorError: não esperar item por selector compartilhado'); },
    click: async () => { if (clickError) throw new Error('element.click failed'); assert.equal(description, 'Link Sticker'); elementClicks.push(description); clicks.push(description); if (transition && clicks.length >= after) panel = false; },
  }));
  const session = {
    execute: async (command, args) => {
      assert.equal(command, 'mobile: clickGesture');
      assert.deepEqual(Object.keys(args), ['elementId']);
      gestures.push(args.elementId);
      if (gestureError && args.elementId === 'real-Link Sticker') throw new Error('unknown command: clickGesture unsupported');
      assert.ok(args.elementId === 'real-Link Sticker' || args.elementId === 'visual-0');
      clicks.push('Link Sticker');
      if (transition && clicks.length >= after) panel = false;
    },
    $: async selector => {
      assert.ok(!selector.includes(STICKER_ITEM_ID), 'StrictSelectorError: nenhum seletor desse ID pode usar $');
      return { isExisting: async () => false, isDisplayed: async () => false };
    },
    $$: async selector => {
      if (selector.includes('link_sticker_list_')) return panel ? [] : [{}];
      if (!panel) return [];
      if (selector === resourceIdSelector(STICKER_ITEM_ID)) return items;
      if (selector === '~Link Sticker') return items.filter((_, index) => descriptions[index] === 'Link Sticker');
      assert.equal(selector, LINK_ITEM_SELECTOR);
      const matches = [];
      for (const item of items) if (await item.getAttribute('content-desc') === 'Link Sticker') matches.push(item);
      return matches;
    },
    saveScreenshot: async path => { const { writeFile } = await import('node:fs/promises'); await writeFile(path, 'fixture'); },
    getCurrentPackage: async () => 'com.instagram.android',
    waitUntil: async condition => { for (let i = 0; i < 2; i++) if (await condition()) return true; throw new Error('timeout'); },
    getPageSource: async () => panel ? '<hierarchy><node content-desc="Link Sticker" resource-id="com.instagram.android:id/sticker_sheet_redesign_item"/></hierarchy>'
      : '<hierarchy><node text="URL" resource-id="fixture:id/input" class="android.widget.EditText"/><node text="Done" class="android.widget.Button"/></hierarchy>',
  };
  return { session, clicks, gestures, elementClicks };
}

test('ID compartilhado: clica somente no item de descrição exata Link Sticker', async () => {
  const mock = fixture(['Location', 'Link Sticker', 'Music']);
  const before = await mock.session.getPageSource();
  assert.equal(await clickExactLinkSticker(mock.session), LINK_ACCESSIBILITY_SELECTOR);
  assert.deepEqual(mock.clicks, ['Link Sticker']);
  await waitForLinkEditor(mock.session, before);
});

test('dois Link Sticker recusam ambiguidade sem clique', async () => {
  const mock = fixture(['Link Sticker', 'Link Sticker']);
  await assert.rejects(clickExactLinkSticker(mock.session), /encontrados 2/);
  assert.deepEqual(mock.clicks, []);
});

test('não escolhe primeiro item quando LINK está ausente ou tem descrição diferente', async () => {
  const mock = fixture(['Location', 'link sticker', 'Music']);
  await assert.rejects(clickExactLinkSticker(mock.session), /encontrados 0/);
  assert.deepEqual(mock.clicks, []);
});

test('coleção vazia falha antes de selecionar um item', async () => {
  const mock = fixture([]);
  await assert.rejects(clickExactLinkSticker(mock.session), /Painel de stickers não confirmado/);
  assert.deepEqual(mock.clicks, []);
});

test('gesto sem transição e sem descendente e salva diagnóstico antes de abortar', async () => {
  const mock = fixture(['Link Sticker'], { transition: false });
  const { mkdtemp, readdir } = await import('node:fs/promises');
  const dir = await mkdtemp('/tmp/click-link-test-');
  await assert.rejects(clickExactLinkSticker(mock.session, dir), /clickGesture não abriu/);
  assert.deepEqual(mock.clicks, ['Link Sticker']);
  for (const name of ['click-link-before', 'click-link-after', 'click-link-failed']) {
    for (const ext of ['json', 'png', 'xml']) assert.ok((await readdir(dir)).includes(`${name}.${ext}`));
  }
});
test('falha técnica do gesto usa element.click uma única vez', async () => {
  const mock = fixture(['Link Sticker'], { gestureError: true });
  await clickExactLinkSticker(mock.session);
  assert.deepEqual(mock.clicks, ['Link Sticker']);
  assert.deepEqual(mock.elementClicks, ['Link Sticker']);
});
for (const options of [{ hidden: true }, { enabled: false }]) {
  test(`LINK não interagível aborta sem clique: ${JSON.stringify(options)}`, async () => {
    const mock = fixture(['Link Sticker'], options);
    await assert.rejects(clickExactLinkSticker(mock.session), /visível\/habilitado/);
    assert.deepEqual(mock.clicks, []);
  });
}

test('identifica apenas candidatos observados, sem assumir URL por classe isolada', () => {
  const element = (text, cls) => ({ text, 'content-desc': '', 'resource-id': '', class: cls });
  const input = element('Web address', 'android.widget.EditText');
  const done = element('Done', 'android.widget.Button');
  const result = inspectLinkEditorElements([input, done, element('', 'android.widget.EditText'), element('Customize sticker text', 'android.widget.TextView')]);
  assert.deepEqual(result.urlFields, [input]);
  assert.deepEqual(result.confirmations, [done]);
  assert.equal(result.relevant.length, 3);
});

test('DRY_RUN diferente de true impede qualquer clique', async () => {
  const mock = fixture(['Link Sticker']);
  process.env.DRY_RUN = 'false';
  try { await assert.rejects(clickExactLinkSticker(mock.session), /DRY_RUN=true/); }
  finally { process.env.DRY_RUN = 'true'; }
  assert.deepEqual(mock.clicks, []);
});


test('17 itens compartilhados selecionam apenas LINK no meio da coleção sem seleção estrita', async () => {
  const descriptions = Array.from({ length: 17 }, (_, index) => index === 9 ? 'Link Sticker' : `Sticker ${index}`);
  const mock = fixture(descriptions);
  await clickExactLinkSticker(mock.session);
  assert.deepEqual(mock.clicks, ['Link Sticker']);
});

test('marcadores reais confirmam transição sem depender de XML genérico', async () => {
  const mock = fixture(['Link Sticker']);
  mock.session.getPageSource = async () => '<hierarchy/>'; // XML sem sinais de editor não impede marcadores reais.
  await clickExactLinkSticker(mock.session);
  assert.deepEqual(mock.clicks, ['Link Sticker']);
});
test('falha de conexão após clique não é tratada como convite para repetir', async () => {
  const mock = fixture(['Link Sticker'], { transition: false });
  const query = mock.session.$$;
  mock.session.$$ = async selector => {
    if (mock.clicks.length && selector.includes('link_sticker_list_')) throw new Error('connection refused');
    return query(selector);
  };
  await assert.rejects(clickExactLinkSticker(mock.session), /connection refused/);
  assert.deepEqual(mock.clicks, ['Link Sticker']);
});

test('gesto usa elementId real sem executar element.click', async () => {
  const mock = fixture(['Link Sticker']);
  await clickExactLinkSticker(mock.session);
  assert.deepEqual(mock.gestures, ['real-Link Sticker']);
  assert.deepEqual(mock.elementClicks, []);
});
test('único descendente visual comprovado por busca no pai pode receber uma tentativa', async () => {
  const mock = fixture(['Link Sticker'], { after: 2, descendants: 1 });
  await clickExactLinkSticker(mock.session);
  assert.deepEqual(mock.gestures, ['real-Link Sticker', 'visual-0']);
  assert.deepEqual(mock.elementClicks, []);
});
test('descendentes ambíguos nunca são escolhidos por índice', async () => {
  const mock = fixture(['Link Sticker'], { transition: false, descendants: 2 });
  await assert.rejects(clickExactLinkSticker(mock.session), /clickGesture não abriu/);
  assert.deepEqual(mock.gestures, ['real-Link Sticker']);
  assert.deepEqual(mock.elementClicks, []);
});

test('gesto e fallback tecnicamente falhos permitem um descendente comprovado', async () => {
  const mock = fixture(['Link Sticker'], { gestureError: true, clickError: true, descendants: 1 });
  await clickExactLinkSticker(mock.session);
  assert.deepEqual(mock.gestures, ['real-Link Sticker', 'visual-0']);
  assert.deepEqual(mock.elementClicks, []);
});
