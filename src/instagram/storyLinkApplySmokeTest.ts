import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { StoryLinkPublisher } from './StoryLinkPublisher.js';
import { InstagramDriver } from './InstagramDriver.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { resolveStoryUrl } from './storyLinkFill.js';

import { applyStoryLink, inspectAppliedLink } from './storyLinkApply.js';

const driver = new InstagramDriver();
const publisher = new StoryLinkPublisher(driver);
const directory = resolve('artifacts', `story-link-apply-${Date.now()}`);
let connected = false;
try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true; não será alterado.');
  const url = resolveStoryUrl(process.argv[2], process.env.STORY_URL);
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  const confirmedValue = await applyStoryLink(driver.getSession(), url,
    () => publisher.loadImageIntoStory('assets/story-test.jpg', join(directory, 'image-flow')));
  const { elements } = await saveScreenArtifacts(driver, directory, 'story-with-link');
  const inspection = inspectAppliedLink(elements, confirmedValue);
  console.log('Elementos relacionados ao link:', JSON.stringify(inspection.relevant, null, 2));
  if (inspection.confirmedByHierarchy) console.log('[5] Link Sticker aplicado: evidência na hierarquia', JSON.stringify(inspection.evidence));
  else console.log('[5] Editor confirmado; Link Sticker não confirmado por seletor. Verifique story-with-link.png.');
  console.log('[6] DRY_RUN: publicação bloqueada');
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify({ confirmedValue, doneClicked: true, editorConfirmed: true, ...inspection, published: false }, null, 2)}\n`, 'utf8');
  console.log('[7] Pronto para próxima etapa');
} catch (error: unknown) {
  console.error('Falha ao aplicar do Link Sticker:', error);
  process.exitCode = 1;
  if (connected) {
    try { await saveScreenArtifacts(driver, directory, 'error'); }
    catch (captureError: unknown) { console.error('Falha no diagnóstico de erro:', captureError); }
  }
} finally {
  try { await driver.disconnect(); }
  catch (error: unknown) {
    console.error('Falha ao encerrar apenas a sessão Appium:', error);
    process.exitCode = 1;
    if (connected) {
      try { await saveScreenArtifacts(driver, directory, 'error'); }
      catch (captureError: unknown) { console.error('Falha no diagnóstico de encerramento:', captureError); }
    }
  }
  console.log(`Artefatos: ${directory} (podem conter dados pessoais; ignorados pelo Git).`);
}
