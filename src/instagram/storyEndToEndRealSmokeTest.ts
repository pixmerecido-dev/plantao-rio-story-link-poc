import { verifyPublicationAccount } from "./publicationAccountGuard.js";
import { assertExecutableStoryMedia } from '../media/StoryMedia.js';
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validatePrepareJob } from '../config/prepareStoryJob.js';
import { InstagramDriver } from './InstagramDriver.js';
import { prepareAndPublishStory } from './storyEndToEndReal.js';
import { saveScreenArtifacts } from './diagnostics.js';

const driver = new InstagramDriver();
const directory = resolve('artifacts', `story-end-to-end-real-${Date.now()}`);
let connected = false;
try {
  const job = await validatePrepareJob(); // Antes de qualquer interação com Android.
  assertExecutableStoryMedia(job.media);
  if (process.env.DRY_RUN !== 'true') throw new Error('Configure DRY_RUN=true; publicação exige as duas travas explícitas.');
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  const account = await verifyPublicationAccount(driver, join(directory, "account-check"));
  const result = { ...await prepareAndPublishStory(driver, job, directory), account_verification: account, account_id: account.account_id, instagram_username: account.account_detected };
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (result.publication.outcome !== 'SUCCESS' || result.publication.captureErrors.length) process.exitCode = 2;
} catch (error) {
  console.error('Fluxo interrompido; não repetir publicação sem conferir o resultado localmente:', error);
  process.exitCode = 1;
  if (connected) {
    try { await saveScreenArtifacts(driver, directory, 'error'); }
    catch (captureError) { console.error('Falha na captura:', captureError); }
  }
} finally {
  try { await driver.disconnect(); }
  catch (error) { console.error('Falha ao encerrar somente a sessão Appium:', error); process.exitCode = 1; }
  console.log(`Artefatos: ${directory}`);
}
