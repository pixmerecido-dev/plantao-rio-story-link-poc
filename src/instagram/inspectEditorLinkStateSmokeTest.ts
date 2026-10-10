import 'dotenv/config';
import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { InstagramDriver } from './InstagramDriver.js';
import { detectInstagramState, isEditorState } from './instagramStateMachine.js';
import { inspectAppliedLinkSticker } from './appliedLinkSticker.js';
import { saveScreenArtifacts } from './diagnostics.js';

const driver = new InstagramDriver();
const directory = resolve('artifacts', `inspect-editor-link-state-${Date.now()}`);
let connected = false;
try {
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  // Não activateApp, back, navegação, campos ou cliques.
  if (await driver.getSession().getCurrentPackage() !== 'com.instagram.android') throw new Error('Deixe Instagram no editor atual.');
  await saveScreenArtifacts(driver, directory, 'editor-link-state');
  const state = await detectInstagramState(driver.getSession());
  if (!isEditorState(state)) throw new Error(`Inspeção exige editor; estado atual: ${state}.`);
  const report = await inspectAppliedLinkSticker(driver.getSession());
  await writeFile(join(directory, 'link-detection.json'), `${JSON.stringify({ state, ...report }, null, 2)}\n`, 'utf8');
  console.log(`[STATE] ${state}`);
} catch (error) {
  console.error('Falha na inspeção do editor:', error); process.exitCode = 1;
  if (connected) {
    try { await saveScreenArtifacts(driver, directory, 'error'); }
    catch (captureError) { console.error('Falha na captura:', captureError); }
  }
} finally {
  try { await driver.disconnect(); } catch (error) { console.error('Falha ao encerrar sessão:', error); process.exitCode = 1; }
  console.log(`Artefatos: ${directory}`);
}
