import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { StoryLinkPublisher } from './StoryLinkPublisher.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { isStoryEditor, openStickersPanel, relevantStickerElements, linkStickerElements } from './storyStickers.js';
import { selectorForObservedElement } from './storyMediaInspection.js';

const driver = new InstagramDriver();
const publisher = new StoryLinkPublisher(driver);
const directory = resolve('artifacts', `story-stickers-${Date.now()}`);
let connected = false;

try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true; o teste não altera a variável.');
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  if (!(await isStoryEditor(driver.getSession()))) {
    const filename = await publisher.findExistingTestImage(process.argv[2] ?? 'assets/story-test.jpg');
    await publisher.loadImageIntoStory(filename, join(directory, 'image-flow'));
  } else {
    console.log('Editor já aberto: reutilizando o rascunho atual, sem selecionar outra imagem.');
  }
  await saveScreenArtifacts(driver, directory, 'editor-before-stickers');
  const clickedSelector = await openStickersPanel(driver.getSession());
  const { elements } = await saveScreenArtifacts(driver, directory, 'stickers');
  const relevant = relevantStickerElements(elements);
  const links = linkStickerElements(elements);
  console.log(`[5] Elementos encontrados: ${relevant.length}`);
  for (const element of relevant) {
    console.log(JSON.stringify(element));
    console.log(`Seletor derivado dos atributos observados (não clicado): ${selectorForObservedElement(element)}`);
  }
  if (links.length) {
    for (const link of links) console.log(`[6] LINK encontrado: ${JSON.stringify(link)}`);
  } else {
    console.log('[6] LINK não observado com rótulo exato nesta captura; nenhum clique adicional.');
  }
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify({ clickedSelector, relevant, links, published: false, linkClicked: false }, null, 2)}\n`, 'utf8');
  console.log('[7] Pronto para próxima etapa');
} catch (error: unknown) {
  console.error('Falha no teste do painel de stickers:', error);
  process.exitCode = 1;
  if (connected) {
    try { await saveScreenArtifacts(driver, directory, 'error'); }
    catch (captureError: unknown) { console.error('Falha ao salvar diagnóstico de erro:', captureError); }
  }
} finally {
  try { await driver.disconnect(); }
  catch (error: unknown) {
    console.error('Erro ao encerrar apenas a sessão Appium:', error);
    process.exitCode = 1;
    if (connected) {
      try { await saveScreenArtifacts(driver, directory, 'error'); }
      catch (captureError: unknown) { console.error('Falha ao salvar diagnóstico de encerramento:', captureError); }
    }
  }
  console.log(`Artefatos: ${directory} (podem conter dados pessoais; ignorados pelo Git).`);
}
