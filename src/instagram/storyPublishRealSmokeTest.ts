import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { assertRealPublishAllowed, publishStoryOnce } from './storyPublishReal.js';
import { saveScreenArtifacts } from './diagnostics.js';

const driver = new InstagramDriver();
const directory = resolve('artifacts', `publish-real-${Date.now()}`);
let connected = false;
try {
  // Sem ambas as travas, nem conecta ao Appium ou modifica o aplicativo.
  assertRealPublishAllowed();
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  const result = await publishStoryOnce(driver, directory);
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (result.outcome !== 'SUCCESS' || result.captureErrors.length > 0) process.exitCode = 2;
} catch (error: unknown) {
  console.error('Publicação interrompida; não execute novamente sem conferir o Story localmente:', error);
  process.exitCode = 1;
  if (connected) {
    try { await saveScreenArtifacts(driver, directory, 'error'); }
    catch (captureError: unknown) { console.error('Falha na captura de erro:', captureError); }
  }
} finally {
  try { await driver.disconnect(); }
  catch (error: unknown) { console.error('Falha ao encerrar somente a sessão Appium:', error); process.exitCode = 1; }
  console.log(`Artefatos: ${directory}`);
}
