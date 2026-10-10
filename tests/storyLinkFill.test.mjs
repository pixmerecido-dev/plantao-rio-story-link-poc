import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fillStoryLinkUrl, resolveStoryUrl, DEFAULT_STORY_URL } from '../dist/instagram/storyLinkFill.js';
import { resourceIdSelector, STICKER_ITEM_ID } from '../dist/instagram/instagramStateMachine.js';
import { LINK_URL_ID, LINK_DONE_ID, LINK_EDITOR_MARKERS } from '../dist/instagram/linkEditorSelectors.js';
const original = process.env.DRY_RUN;
process.env.DRY_RUN = 'true';
after(() => { if (original === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = original; });

function fixture({ stickers = false, mismatch = false } = {}) {
  let panel = stickers;
  let value = 'https://old.example/';
  const actions = [];
  const field = {
    waitForExist: async () => assert.equal(panel, false), waitForDisplayed: async () => {}, isEnabled: async () => true,
    clearValue: async () => { actions.push('clear'); value = ''; },
    addValue: async input => { actions.push(['type', input]); value += input; },
    getText: async () => mismatch ? 'different' : value,
    click: () => { throw new Error('Não clicar no campo ou confirmar'); },
  };
  const done = { waitForExist: async () => {}, waitForDisplayed: async () => {}, click: () => { throw new Error('Done não pode ser clicado'); } };
  const items = Array.from({ length: 17 }, (_, index) => ({
    elementId: `sticker-${index}`, isExisting: async () => true,
    getAttribute: async name => name === 'content-desc' ? index === 7 ? 'Link Sticker' : 'Other' : STICKER_ITEM_ID,
    getText: async () => '', isDisplayed: async () => panel, isEnabled: async () => true,
    click: async () => { assert.equal(index, 7); actions.push('LINK'); panel = false; },
  }));
  const session = {
    getPageSource: async () => '<hierarchy/>',
    saveScreenshot: async path => { const { writeFile } = await import('node:fs/promises'); await writeFile(path, 'fixture'); },
    execute: async (command, args) => {
      assert.equal(command, 'mobile: clickGesture');
      assert.deepEqual(Object.keys(args), ['elementId']);
      const matching = items.filter(item => item.elementId === args.elementId);
      assert.equal(matching.length, 1);
      for (const item of matching) await item.click();
    },
    $$: async selector => {
      if (LINK_EDITOR_MARKERS.some(id => resourceIdSelector(id) === selector)) return panel ? [] : [{}];
      if (selector === resourceIdSelector(STICKER_ITEM_ID)) return panel ? items : [];
      if (selector === '~Link Sticker') return panel ? [items[7]] : [];
      throw new Error(`Seletor inesperado ${selector}`);
    },
    $: async selector => {
      assert.ok(!selector.includes(STICKER_ITEM_ID), 'ID compartilhado nunca pode usar $');
      if (selector === resourceIdSelector(LINK_URL_ID)) return field;
      assert.equal(selector, resourceIdSelector(LINK_DONE_ID));
      return done;
    },
    getCurrentPackage: async () => 'com.instagram.android',
    waitUntil: async condition => { for (let i = 0; i < 2; i++) if (await condition()) return true; throw new Error('timeout'); },
  };
  return { session, actions };
}

test('editor aberto limpa conteúdo anterior e confirma URL variável sem clicar Done', async () => {
  const mock = fixture();
  const url = 'https://plantaorio.com.br/?id=123&source=poc';
  assert.equal(await fillStoryLinkUrl(mock.session, url), url);
  assert.deepEqual(mock.actions, ['clear', ['type', url]]);
});

test('painel com 17 itens clica somente LINK e preenche sem confirmar', async () => {
  const mock = fixture({ stickers: true });
  assert.equal(await fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL), DEFAULT_STORY_URL);
  assert.deepEqual(mock.actions, ['LINK', 'clear', ['type', DEFAULT_STORY_URL]]);
});

test('valor divergente falha e não confirma', async () => {
  const mock = fixture({ mismatch: true });
  await assert.rejects(fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL), /timeout/);
  assert.deepEqual(mock.actions, ['clear', ['type', DEFAULT_STORY_URL]]);
});

test('DRY_RUN falso impede limpar, preencher e clicar', async () => {
  const mock = fixture(); process.env.DRY_RUN = 'false';
  try { await assert.rejects(fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL), /DRY_RUN=true/); }
  finally { process.env.DRY_RUN = 'true'; }
  assert.deepEqual(mock.actions, []);
});

test('URL aceita parâmetro, variável e padrão sem normalizar valor', () => {
  assert.equal(resolveStoryUrl(), DEFAULT_STORY_URL);
  assert.equal(resolveStoryUrl(undefined, 'https://example.org'), 'https://example.org');
  assert.equal(resolveStoryUrl('https://example.net', 'https://example.org'), 'https://example.net');
  assert.throws(() => resolveStoryUrl('javascript:alert(1)'), /HTTP/);
  assert.throws(() => resolveStoryUrl(' https://example.org '), /HTTP/);
});

// Executa os navegadores reais sobre uma sessão simulada para todos os estados.
function endToEndFixture(initialState, { modern = false, destination = 'STATE_GALLERY', description = 'Add to story', separate = false, buttonClass = 'android.widget.Button', enabled = true, clickable = 'true', allowDone = false, doneReturns = 'STATE_EDITOR' } = {}) {
  let state = initialState;
  let value = 'previous';
  const actions = [];
  const id = selector => {
    if (selector === '~Stickers') return 'asset_button';
    if (selector === '~Add to story') return 'accessible-add';
    return selector.match(/resourceId\("([^"]+)"\)/)?.[1];
  };
  const visible = resource => ({
    STATE_HOME: ['com.instagram.android:id/feed_tab', modern ? 'com.instagram.android:id/reel_empty_badge' : 'com.instagram.android:id/action_bar_left_button', ...(modern && description === 'Add to story' || separate ? ['accessible-add'] : [])],
    STATE_CREATE: ['com.instagram.android:id/cam_dest_story'],
    STATE_GALLERY: ['com.instagram.android:id/gallery_grid_container'],
    STATE_EDITOR: ['asset_button'],
    STATE_STICKERS: [STICKER_ITEM_ID],
    STATE_LINK_EDITOR: [LINK_URL_ID, LINK_DONE_ID],
  }[state] ?? []).includes(resource);
  const element = resource => ({
    isExisting: async () => visible(resource), isDisplayed: async () => visible(resource), isEnabled: async () => enabled,
    getAttribute: async name => name === 'class' ? buttonClass : name === 'clickable' ? clickable : name === 'content-desc' ? resource === 'com.instagram.android:id/reel_empty_badge' ? description : resource === 'accessible-add' ? 'Add to story' : 'Stickers' : resource,
    waitForExist: async () => assert.ok(visible(resource)), waitForDisplayed: async () => assert.ok(visible(resource)),
    click: async () => {
      if (resource === LINK_DONE_ID) {
        assert.ok(allowDone, 'Done nunca pode ser clicado no fluxo fill');
        actions.push('Done'); state = doneReturns; return;
      }
      assert.notEqual(resource, 'com.instagram.android:id/reel_empty_badge', 'badge visual nunca pode ser clicado');
      const next = { 'com.instagram.android:id/reel_empty_badge': destination, 'accessible-add': destination, 'com.instagram.android:id/action_bar_left_button': 'STATE_CREATE', 'com.instagram.android:id/cam_dest_story': 'STATE_GALLERY', asset_button: 'STATE_STICKERS' }[resource];
      assert.ok(next, 'controle inesperado não pode ser clicado');
      actions.push(resource); state = next;
    },
    clearValue: async () => { assert.equal(resource, LINK_URL_ID); actions.push('clear'); value = ''; },
    addValue: async input => { assert.equal(resource, LINK_URL_ID); actions.push(['type', input]); value += input; },
    getText: async () => value,
  });
  const items = Array.from({ length: 17 }, (_, index) => ({
    elementId: `sticker-${index}`, isExisting: async () => true,
    getAttribute: async name => name === 'content-desc' ? index === 8 ? 'Link Sticker' : 'Other' : STICKER_ITEM_ID,
    getText: async () => '', isDisplayed: async () => state === 'STATE_STICKERS', isEnabled: async () => true,
    click: async () => { assert.equal(index, 8); actions.push('LINK'); state = 'STATE_LINK_EDITOR'; },
  }));
  const session = {
    getPageSource: async () => '<hierarchy/>',
    saveScreenshot: async path => { const { writeFile } = await import('node:fs/promises'); await writeFile(path, 'fixture'); },
    execute: async (command, args) => {
      assert.equal(command, 'mobile: clickGesture');
      assert.deepEqual(Object.keys(args), ['elementId']);
      const matching = items.filter(item => item.elementId === args.elementId);
      assert.equal(matching.length, 1);
      for (const item of matching) await item.click();
    },
    $: async selector => { assert.ok(!selector.includes(STICKER_ITEM_ID)); return element(id(selector)); },
    $$: async selector => {
      if (id(selector) === STICKER_ITEM_ID) return state === 'STATE_STICKERS' ? items : [];
      if (selector === '~Link Sticker') return state === 'STATE_STICKERS' ? [items[8]] : [];
      return visible(id(selector)) ? [element(id(selector))] : [];
    },
    pause: async () => {},
    waitUntil: async condition => { for (let attempt = 0; attempt < 2; attempt++) if (await condition()) return true; throw new Error('timeout'); },
    getCurrentPackage: async () => 'com.instagram.android',
  };
  return { session, actions, selectImage: async () => { assert.equal(state, 'STATE_GALLERY'); actions.push('photo'); state = 'STATE_EDITOR'; } };
}

const { navigateToStoryEditor } = await import('../dist/instagram/instagramStateMachine.js');
for (const [initialState, expected] of [
  ['STATE_HOME', ['com.instagram.android:id/action_bar_left_button', 'com.instagram.android:id/cam_dest_story', 'photo', 'asset_button', 'LINK']],
  ['STATE_CREATE', ['com.instagram.android:id/cam_dest_story', 'photo', 'asset_button', 'LINK']],
  ['STATE_GALLERY', ['photo', 'asset_button', 'LINK']],
  ['STATE_EDITOR', ['asset_button', 'LINK']],
  ['STATE_STICKERS', ['LINK']],
  ['STATE_LINK_EDITOR', []],
]) {
  test(`fluxo completo partindo de ${initialState} preenche URL e nunca confirma`, async () => {
    const mock = endToEndFixture(initialState);
    const actual = await fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL,
      () => navigateToStoryEditor(mock.session, mock.selectImage));
    assert.equal(actual, DEFAULT_STORY_URL);
    assert.deepEqual(mock.actions, [...expected, 'clear', ['type', DEFAULT_STORY_URL]]);
  });
}

test('estado desconhecido aborta sem navegação ou preenchimento', async () => {
  const mock = endToEndFixture('STATE_UNKNOWN');
  await assert.rejects(fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL,
    () => navigateToStoryEditor(mock.session, mock.selectImage)), /STATE_UNKNOWN/);
  assert.deepEqual(mock.actions, []);
});

for (const destination of ['STATE_CREATE', 'STATE_GALLERY', 'STATE_EDITOR']) {
  test(`Home atual redetecta ${destination} e preenche sem Done`, async () => {
    const mock = endToEndFixture('STATE_HOME', { modern: true, destination });
    await fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL,
      () => navigateToStoryEditor(mock.session, mock.selectImage));
    assert.equal(mock.actions[0], 'accessible-add');
    assert.equal(mock.actions.filter(action => action === 'accessible-add').length, 1);
    assert.deepEqual(mock.actions.slice(-2), ['clear', ['type', DEFAULT_STORY_URL]]);
  });
}
test('Home atual aceita Add to story em nó separado e clica só no atalho acessível', async () => {
  const mock = endToEndFixture('STATE_HOME', { modern: true, description: '', separate: true });
  await fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL, () => navigateToStoryEditor(mock.session, mock.selectImage));
  assert.equal(mock.actions[0], 'accessible-add');
});
test('Home atual sem associação Add to story aborta sem clicar em outra conta', async () => {
  const mock = endToEndFixture('STATE_HOME', { modern: true, description: 'Other account' });
  await assert.rejects(fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL,
    () => navigateToStoryEditor(mock.session, mock.selectImage)), /Add to story ausente/);
  assert.deepEqual(mock.actions, []);
});

test('Home sem botão ou com múltiplos botões Add to story aborta sem clique nem preenchimento', async () => {
  for (const count of [0, 2]) {
    const mock = endToEndFixture('STATE_HOME', { modern: true });
    const query = mock.session.$$;
    mock.session.$$ = async selector => selector === '~Add to story'
      ? count === 0 ? [] : [...await query(selector), ...await query(selector)] : query(selector);
    await assert.rejects(fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL), /ausente ou ambíguo/);
    assert.deepEqual(mock.actions, []);
  }
});
test('rota tradicional tem prioridade e não consulta fallback quando Criar existe', async () => {
  const mock = endToEndFixture('STATE_HOME');
  const query = mock.session.$$;
  mock.session.$$ = async selector => {
    assert.notEqual(selector, resourceIdSelector('com.instagram.android:id/reel_empty_badge'));
    return query(selector);
  };
  await fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL, () => navigateToStoryEditor(mock.session, mock.selectImage));
  assert.equal(mock.actions[0], 'com.instagram.android:id/action_bar_left_button');
});

for (const options of [{ buttonClass: 'android.view.View' }, { enabled: false }, { clickable: 'false' }]) {
  test(`Add to story inválido aborta sem clique: ${JSON.stringify(options)}`, async () => {
    const mock = endToEndFixture('STATE_HOME', { modern: true, ...options });
    await assert.rejects(fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL), /ausente ou ambíguo|habilitado/);
    assert.deepEqual(mock.actions, []);
  });
}
test('Add to story clicado sem mudança de tela aborta com mensagem explícita, sem segundo clique', async () => {
  const mock = endToEndFixture('STATE_HOME', { modern: true, destination: 'STATE_HOME' });
  await assert.rejects(fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL), /Add to story clicado, mas permaneceu na Home/);
  assert.deepEqual(mock.actions, ['accessible-add']);
});
test('badge ausente não impede clicar no botão acessível confirmado', async () => {
  const mock = endToEndFixture('STATE_HOME', { modern: true });
  const query = mock.session.$$;
  mock.session.$$ = async selector => {
    assert.notEqual(selector, resourceIdSelector('com.instagram.android:id/reel_empty_badge'));
    return query(selector);
  };
  await fillStoryLinkUrl(mock.session, DEFAULT_STORY_URL, () => navigateToStoryEditor(mock.session, mock.selectImage));
  assert.equal(mock.actions[0], 'accessible-add');
});

const { applyStoryLink, inspectAppliedLink } = await import('../dist/instagram/storyLinkApply.js');
for (const state of ['STATE_HOME', 'STATE_CREATE', 'STATE_GALLERY', 'STATE_EDITOR', 'STATE_STICKERS', 'STATE_LINK_EDITOR']) {
  test(`aplica link partindo de ${state} com DRY_RUN=true e clica somente um Done`, async () => {
    const mock = endToEndFixture(state, { allowDone: true });
    assert.equal(await applyStoryLink(mock.session, DEFAULT_STORY_URL,
      () => navigateToStoryEditor(mock.session, mock.selectImage)), DEFAULT_STORY_URL);
    assert.equal(mock.actions.filter(action => action === 'Done').length, 1);
    assert.equal(mock.actions.at(-1), 'Done');
  });
}
test('timeout após Done não repete clique nem tenta publicar', async () => {
  const mock = endToEndFixture('STATE_LINK_EDITOR', { allowDone: true, doneReturns: 'STATE_LINK_EDITOR' });
  await assert.rejects(applyStoryLink(mock.session, DEFAULT_STORY_URL), /timeout/);
  assert.deepEqual(mock.actions, ['clear', ['type', DEFAULT_STORY_URL], 'Done']);
});
test('evidência de link usa atributos reais e não confunde botão Stickers com sticker aplicado', () => {
  const button = { text: '', 'content-desc': 'Stickers', 'resource-id': 'asset_button', class: 'android.widget.Button' };
  assert.equal(inspectAppliedLink([button], DEFAULT_STORY_URL).confirmedByHierarchy, false);
  const link = { ...button, 'content-desc': 'Link sticker plantaorio.com.br' };
  assert.equal(inspectAppliedLink([button, link], DEFAULT_STORY_URL).confirmedByHierarchy, true);
  assert.equal(inspectAppliedLink([], DEFAULT_STORY_URL).confirmedByHierarchy, false);
});
