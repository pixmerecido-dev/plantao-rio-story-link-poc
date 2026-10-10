import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { StoryLinkPublisher } from './StoryLinkPublisher.js';
import { detectInstagramState } from './instagramStateMachine.js';
import { ensureStickersPanel } from './storyStickers.js';
import { clickExactLinkSticker, inspectLinkEditorElements, waitForLinkEditor } from './storyLinkInspection.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { selectorForObservedElement } from './storyMediaInspection.js';

const driver = new InstagramDriver();
const publisher = new StoryLinkPublisher(driver);
const directory = resolve('artifacts', `story-link-${Date.now()}`);
let connected = false;
try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true; a variável não é alterada.');
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  const session = driver.getSession();
  const initialState = await detectInstagramState(session);
  console.log(`[STATE] ${initialState}`);
  if (initialState !== 'STATE_STICKERS' && initialState !== 'STATE_EDITOR') {
    await publisher.loadImageIntoStory(process.argv[2] ?? 'assets/story-test.jpg', join(directory, 'image-flow'));
  }
  await ensureStickersPanel(session);
  const { source: beforeSource } = await saveScreenArtifacts(driver, directory, 'stickers-before-link');
  const clickedSelector = await clickExactLinkSticker(session, directory);
  let transitionError: unknown;
  try { await waitForLinkEditor(session, beforeSource); }
  catch (error: unknown) { transitionError = error; }
  // Mesmo se a tela não for reconhecida, preserva a captura para descobrir atributos.
  const { elements } = await saveScreenArtifacts(driver, directory, 'link-editor');
  if (transitionError) throw transitionError;
  console.log('[5] Tela de configuração aberta');
  const observed = inspectLinkEditorElements(elements);
  for (const element of observed.relevant) {
    console.log(`Elemento relacionado observado: ${JSON.stringify(element)}`);
    console.log(`Seletor derivado, não acionado: ${selectorForObservedElement(element)}`);
  }
  if (observed.urlFields.length) {
    for (const field of observed.urlFields) console.log(`[6] Campo URL encontrado (candidato observado): ${JSON.stringify(field)}`);
  } else console.log('[6] Campo URL não identificado inequivocamente; revisar link-editor.xml (nenhum campo preenchido).');
  if (observed.confirmations.length) {
    for (const button of observed.confirmations) console.log(`[7] Botão de confirmação encontrado (Done observado): ${JSON.stringify(button)}`);
  } else console.log('[7] Botão de confirmação não identificado nesta captura (nenhum botão acionado).');
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify({ initialState, clickedSelector, ...observed,
    urlEntered: false, confirmationClicked: false, published: false }, null, 2)}\n`, 'utf8');
  console.log('[8] Pronto para próxima etapa');
} catch (error: unknown) {
  console.error('Falha ao inspecionar configuração do sticker LINK:', error);
  process.exitCode = 1;
  if (connected) {
    try { await saveScreenArtifacts(driver, directory, 'error'); }
    catch (captureError: unknown) { console.error('Falha no diagnóstico de erro:', captureError); }
  }
} finally {
  try { await driver.disconnect(); }
  catch (error: unknown) {
    console.error('Falha ao encerrar somente a sessão Appium:', error);
    process.exitCode = 1;
    if (connected) {
      try { await saveScreenArtifacts(driver, directory, 'error'); }
      catch (captureError: unknown) { console.error('Falha no diagnóstico de encerramento:', captureError); }
    }
  }
  console.log(`Artefatos: ${directory} (podem conter dados pessoais; ignorados pelo Git).`);
}
