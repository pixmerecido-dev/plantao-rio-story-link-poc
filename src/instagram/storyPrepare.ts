import type { InstagramDriver } from './InstagramDriver.js';
import type { StoryJob } from '../config/StoryJob.js';
import { detectInstagramState, resourceIdSelector, waitForClickable, waitForState } from './instagramStateMachine.js';
import { fillStoryLinkUrl } from './storyLinkFill.js';
import { LINK_CUSTOM_CTA_ID, LINK_URL_ID, LINK_DONE_ID } from './linkEditorSelectors.js';
import { extractInstagramElements, type InstagramElement } from './inspectElements.js';
import { normalizeInstagramToHome } from './normalizeInstagramToHome.js';
import { saveScreenArtifacts } from './diagnostics.js';

type Driver = Pick<InstagramDriver, 'getSession'>;
const WAIT = { timeout: 20_000, interval: 500 };

/** Após abrir o controle custom CTA observado, identifica campo somente no XML real. */
export function discoverCustomTextField(elements: InstagramElement[]): string {
  const fields = elements.filter(element => /(?:^|\.)EditText$/.test(element.class) && element['resource-id'] !== LINK_URL_ID);
  if (fields.length !== 1) throw new Error(`Campo de texto custom CTA não identificado inequivocamente: ${fields.length} EditTexts fora do campo URL. Revise custom-cta.xml.`);
  const [field] = fields;
  if (!field) throw new Error('Campo custom CTA ausente.');
  if (field['resource-id']) return resourceIdSelector(field['resource-id']);
  if (field['content-desc']) return `~${field['content-desc']}`;
  throw new Error('Campo custom CTA não expõe resource-id/accessibility id; diagnóstico salvo, nenhum seletor inventado.');
}

export async function prepareNewStory(driver: Driver, job: StoryJob, directory: string, prepareNewImage: () => Promise<void>) {
  if (process.env.DRY_RUN !== 'true') throw new Error('Preparação exige DRY_RUN=true.');
  const session = driver.getSession();
  await normalizeInstagramToHome(driver, directory);
  if (await detectInstagramState(session) !== 'STATE_HOME') throw new Error('Novo job exige STATE_HOME estabilizado.');
  console.log('[JOB] iniciando novo Story');
  await prepareNewImage();
  if (await detectInstagramState(session) !== 'STATE_EDITOR') throw new Error('Imagem nova não confirmou editor sem link anterior; job cancelado.');
  await fillStoryLinkUrl(session, job.story_url, undefined, { confirmationFollows: true });
  console.log('[LINK] URL preenchida');
  await saveScreenArtifacts(driver, directory, 'link-before-custom-cta');
  const row = await session.$(resourceIdSelector(LINK_CUSTOM_CTA_ID));
  await waitForClickable(session, row);
  if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
  console.log(`[LINK] controle custom CTA observado: ${LINK_CUSTOM_CTA_ID}`);
  await row.click();
  let customSelector: string | undefined;
  try {
    await session.waitUntil(async () => {
      const fields = extractInstagramElements(await session.getPageSource()).filter(element => /(?:^|\.)EditText$/.test(element.class) && element['resource-id'] !== LINK_URL_ID);
      return fields.length > 0;
    }, { ...WAIT, timeoutMsg: 'Campo custom CTA não apareceu; revise a captura local.' });
  } finally { await saveScreenArtifacts(driver, directory, 'custom-cta'); }
  customSelector = discoverCustomTextField(extractInstagramElements(await session.getPageSource()));
  console.log(`[LINK] seletor real do campo personalizado: ${customSelector}`);
  const fields = await session.$$(customSelector);
  if (fields.length !== 1) throw new Error('Campo custom CTA ausente ou ambíguo; nenhum preenchimento.');
  const [field] = fields;
  if (!field || !await field.isDisplayed() || !await field.isEnabled()) throw new Error('Campo custom CTA não está visível/habilitado.');
  await field.clearValue();
  await field.addValue(job.sticker_text);
  if (await field.getText() !== job.sticker_text) throw new Error('STICKER_TEXT não corresponde exatamente ao valor lido.');
  console.log('[LINK] texto personalizado preenchido');
  const url = await session.$(resourceIdSelector(LINK_URL_ID));
  if (!await url.isExisting() || await url.getText() !== job.story_url) throw new Error('URL alterada ou não verificável após custom CTA; Done cancelado.');
  const done = await session.$(resourceIdSelector(LINK_DONE_ID));
  await waitForClickable(session, done);
  if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
  console.log('[LINK] Done');
  await done.click();
  await waitForState(session, 'STATE_EDITOR_WITH_LINK');
  if (await detectInstagramState(session) !== 'STATE_EDITOR_WITH_LINK') throw new Error('Story preparado não atingiu STATE_EDITOR_WITH_LINK.');
  const capture = await saveScreenArtifacts(driver, directory, 'story-prepared');
  console.log('[STATE] STATE_EDITOR_WITH_LINK');
  console.log('[SAFE] publicação não executada');
  console.log('[OK] Story preparado para publicação');
  return { ...job, custom_text_selector: customSelector, url_verified: true, sticker_text_verified: true, published: false, elements: capture.elements };
}
