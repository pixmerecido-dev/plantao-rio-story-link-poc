import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { detectInstagramState, isEditorState } from './instagramStateMachine.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { inspectFacebookShare } from './facebookShareInspection.js';

const driver = new InstagramDriver();
const directory = resolve('artifacts', `facebook-share-${Date.now()}`);
let connected = false;
try {
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  const session = driver.getSession();
  if (await session.getCurrentPackage() !== 'com.instagram.android' || !isEditorState(await detectInstagramState(session))) {
    throw new Error('Deixe o Instagram na tela final do Story; este diagnóstico não navega.');
  }
  const { source } = await saveScreenArtifacts(driver, directory, 'facebook-share-ready');
  const report = inspectFacebookShare(source);
  await writeFile(join(directory, 'facebook-share-ready.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log('[FACEBOOK] diagnóstico:', JSON.stringify(report, null, 2));
  console.log('[SAFE] Diagnóstico somente; configuração e publicação não alteradas.');
} catch (error: unknown) {
  console.error('Falha no diagnóstico Facebook Story:', error); process.exitCode = 1;
  if (connected) {
    try { await saveScreenArtifacts(driver, directory, 'error'); }
    catch (captureError: unknown) { console.error('Falha na captura de erro:', captureError); }
  }
} finally {
  try { await driver.disconnect(); }
  catch (error: unknown) { console.error('Falha ao encerrar sessão Appium:', error); process.exitCode = 1; }
  console.log(`Artefatos: ${directory}`);
}
