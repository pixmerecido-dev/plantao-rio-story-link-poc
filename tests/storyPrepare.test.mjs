import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { validatePrepareJob } from '../dist/config/prepareStoryJob.js';
import { discoverCustomTextField, prepareNewStory } from '../dist/instagram/storyPrepare.js';
import { resourceIdSelector, LINK_STICKER_HOLDER_ID, SHARE_SHORTCUT_ID, STICKER_ITEM_ID } from '../dist/instagram/instagramStateMachine.js';
import { LINK_URL_ID, LINK_DONE_ID, LINK_CUSTOM_CTA_ID } from '../dist/instagram/linkEditorSelectors.js';
const previous = process.env.DRY_RUN;
process.env.DRY_RUN = 'true';
after(() => { if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous; });
const job = { job_id: 'job-test', image: 'supplied.jpg', story_url: 'https://plantaorio.com.br/materia-x?utm=original', sticker_text: ' Leia a matéria completa ', publish_instagram: false, publish_facebook: false };
const actualField = 'fixture:id/observed_custom_text';
function fixture({ initial = 'STATE_HOME', ambiguous = false, mismatch = false, urlChanged = false } = {}) {
  let state = initial, expanded = false, imageCalls = 0;
  const actions = [], values = { [LINK_URL_ID]: '', [actualField]: '' };
  const parse = selector => selector === '~Stickers' ? 'asset_button' : selector.match(/resourceId\("([^"]+)"\)/)?.[1];
  const exists = id => ({ STATE_HOME: ['com.instagram.android:id/feed_tab'], STATE_EDITOR: ['asset_button'], STATE_STICKERS: [STICKER_ITEM_ID], STATE_LINK_EDITOR: [LINK_URL_ID, LINK_DONE_ID, LINK_CUSTOM_CTA_ID, ...(expanded ? [actualField] : [])], STATE_EDITOR_WITH_LINK: ['asset_button', LINK_STICKER_HOLDER_ID, SHARE_SHORTCUT_ID] }[state] ?? []).includes(id);
  const element = id => ({
    elementId: `id-${id}`, isExisting: async () => exists(id), isDisplayed: async () => exists(id), isEnabled: async () => true,
    waitForExist: async () => assert.ok(exists(id)), waitForDisplayed: async () => assert.ok(exists(id)),
    getText: async () => mismatch && id === actualField ? 'modified' : values[id] ?? '',
    getAttribute: async attr => ({ clickable: 'true', 'resource-id': id, 'content-desc': id === STICKER_ITEM_ID ? 'Link Sticker' : id === 'asset_button' ? 'Stickers' : '', class: 'android.widget.Button' })[attr] ?? '',
    clearValue: async () => { actions.push(['clear', id]); values[id] = ''; },
    addValue: async value => { actions.push(['fill', id, value]); values[id] += value; if (urlChanged && id === actualField) values[LINK_URL_ID] = 'https://changed.example/'; },
    click: async () => {
      assert.notEqual(id, SHARE_SHORTCUT_ID, 'NUNCA publicar'); actions.push(['click', id]);
      if (id === 'asset_button') state = 'STATE_STICKERS';
      else if (id === LINK_CUSTOM_CTA_ID) expanded = true;
      else if (id === LINK_DONE_ID) { assert.equal(values[LINK_URL_ID], job.story_url); assert.equal(values[actualField], job.sticker_text); state = 'STATE_EDITOR_WITH_LINK'; }
      else throw new Error('clique inesperado');
    },
  });
  const session = {
    $: async selector => element(parse(selector)),
    $$: async selector => selector === '~Link Sticker' ? state === 'STATE_STICKERS' ? [element(STICKER_ITEM_ID)] : [] : exists(parse(selector)) ? [element(parse(selector))] : [],
    getCurrentPackage: async () => 'com.instagram.android',
    execute: async (name, { elementId }) => { assert.equal(name, 'mobile: clickGesture'); assert.equal(elementId, `id-${STICKER_ITEM_ID}`); actions.push(['gesture', elementId]); state = 'STATE_LINK_EDITOR'; },
    getPageSource: async () => `<hierarchy>${state === 'STATE_LINK_EDITOR' ? `<node class="android.widget.EditText" resource-id="${LINK_URL_ID}"/>${expanded ? `<node class="android.widget.EditText" resource-id="${actualField}"/>${ambiguous ? '<node class="android.widget.EditText" resource-id="fixture:id/other"/>' : ''}` : ''}` : ''}</hierarchy>`,
    saveScreenshot: async path => writeFile(path, 'fixture'),
    waitUntil: async callback => { for (let i = 0; i < 2; i++) if (await callback()) return; throw new Error('timeout'); },
  };
  return { driver: { getSession: () => session }, actions, imageCalls: () => imageCalls,
    prepareImage: async () => { assert.equal(state, 'STATE_HOME'); imageCalls++; state = 'STATE_EDITOR'; } };
}
test('novo job usa URL e CTA exatos e termina no editor com link sem publicar', async () => {
  const mock = fixture();
  const result = await prepareNewStory(mock.driver, job, await mkdtemp('/tmp/story-prepare-'), mock.prepareImage);
  assert.equal(mock.imageCalls(), 1);
  assert.equal(result.custom_text_selector, resourceIdSelector(actualField));
  assert.equal(result.published, false);
  assert.ok(mock.actions.some(action => action[0] === 'fill' && action[2] === job.sticker_text));
  assert.equal(mock.actions.filter(action => action[0] === 'click' && action[1] === LINK_DONE_ID).length, 1);
});
for (const initial of ['STATE_EDITOR', 'STATE_EDITOR_WITH_LINK', 'STATE_LINK_EDITOR', 'STATE_STICKERS']) {
  test(`não reutiliza tarefa anterior em ${initial}`, async () => {
    const mock = fixture({ initial });
    await assert.rejects(prepareNewStory(mock.driver, job, await mkdtemp('/tmp/prepare-existing-'), mock.prepareImage), /exige STATE_HOME/);
    assert.equal(mock.imageCalls(), 0); assert.deepEqual(mock.actions, []);
  });
}
for (const options of [{ ambiguous: true }, { mismatch: true }, { urlChanged: true }]) {
  test(`diagnóstico seguro cancela Done quando campo não confirmado: ${JSON.stringify(options)}`, async () => {
    const mock = fixture(options);
    await assert.rejects(prepareNewStory(mock.driver, job, await mkdtemp('/tmp/prepare-unsafe-'), mock.prepareImage));
    assert.ok(!mock.actions.some(action => action[0] === 'click' && action[1] === LINK_DONE_ID));
  });
}
test('validação externa não aplica defaults nem altera URL/CTA/imagem', async () => {
  const dir = await mkdtemp('/tmp/prepare-job-'); const path = `${dir}/image with spaces.jpg`; await writeFile(path, Buffer.from([255,216,255,1]));
  const input = { JOB_ID: 'external-job', STORY_IMAGE: path, STORY_URL: job.story_url, STICKER_TEXT: job.sticker_text };
  const result = await validatePrepareJob(input);
  assert.equal(result.image, path); assert.equal(result.story_url, input.STORY_URL); assert.equal(result.sticker_text, input.STICKER_TEXT); assert.equal(result.job_id, 'external-job');
  for (const name of ['STORY_IMAGE', 'STORY_URL', 'STICKER_TEXT']) await assert.rejects(validatePrepareJob({ ...input, [name]: undefined }), new RegExp(name));
  await assert.rejects(validatePrepareJob({ ...input, STORY_URL: 'javascript:alert(1)' }));
});
test('campo desconhecido não ganha resource-id inventado', () => {
  assert.throws(() => discoverCustomTextField([{ class: 'android.widget.EditText', text: '', 'content-desc': '', 'resource-id': '' }]), /nenhum seletor inventado/);
});

test('loader obrigatório de mídia nova recusa editor retomado sem selecionar galeria', async () => {
  const { StoryLinkPublisher } = await import('../dist/instagram/StoryLinkPublisher.js');
  const mock = fixture({ initial: 'STATE_EDITOR' });
  const publisher = new StoryLinkPublisher(mock.driver);
  await assert.rejects(publisher.loadImageIntoStory('não deve ler arquivo.jpg', '/tmp/unused-new-story', { requireNewImage: true }), /Nenhuma imagem nova foi selecionada/);
  assert.deepEqual(mock.actions, []);
});
