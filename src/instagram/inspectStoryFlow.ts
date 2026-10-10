import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { extractInstagramElements } from './inspectElements.js';
import { detectInstagramState, reachStoryCreation, STORY_ID, type InstagramState } from './storyFlowInspection.js';

const driver = new InstagramDriver();
const directory = resolve('artifacts', `story-flow-${Date.now()}`);
let connected = false;
let initialState: InstagramState | undefined;
let reached = 'não iniciado';

async function capture(base: string): Promise<void> {
  const session = driver.getSession();
  // Tentativas independentes: uma falha em XML/JSON não impede a screenshot.
  const results = await Promise.allSettled([
    (async () => {
      const source = await session.getPageSource();
      await writeFile(join(directory, `${base}.xml`), source, 'utf8');
      await writeFile(join(directory, `${base}.json`), `${JSON.stringify(extractInstagramElements(source), null, 2)}\n`, 'utf8');
    })(),
    session.saveScreenshot(join(directory, `${base}.png`)),
  ]);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), `Falha na captura ${base}`);
  console.log(`Captura salva: ${base}.xml / .png / .json`);
}

try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Este diagnóstico exige DRY_RUN=true; não altera a variável.');
  await mkdir(directory, { recursive: true });
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  initialState = await detectInstagramState(driver.getSession());
  console.log(`[1] Estado inicial detectado: ${initialState}`);
  reached = initialState;
  await capture('step-01-initial');
  if (initialState === 'STATE_EDITOR_WITH_LINK' || initialState === 'STATE_EDITOR' || initialState === 'STATE_GALLERY' || initialState === 'STATE_STICKERS') {
    console.log(`[NAV] Já está em ${initialState}; não voltar à Home nem selecionar mídia neste diagnóstico.`);
    await capture('step-02-current');
  } else {
    await reachStoryCreation(driver.getSession(), initialState);
    reached = await detectInstagramState(driver.getSession());
    await capture('step-02-create');
  }
  console.log('[5] Pronto para próxima etapa');
} catch (error: unknown) {
  console.error('Falha no diagnóstico da criação:', error);
  process.exitCode = 1;
  if (connected) {
    try { await capture('error'); }
    catch (captureError: unknown) { console.error('Falha na captura de erro:', captureError); }
  }
} finally {
  if (connected) {
    try {
      await writeFile(join(directory, 'summary.json'), `${JSON.stringify({ initialState, reached, storyResourceId: STORY_ID }, null, 2)}\n`, 'utf8');
      console.log(`Artefatos: ${directory} (podem conter dados pessoais; ignorados pelo Git).`);
    } catch (error: unknown) { console.error('Falha ao salvar resumo:', error); process.exitCode = 1; }
  }
  try { await driver.disconnect(); }
  catch (error: unknown) { console.error('Falha ao encerrar sessão Appium:', error); process.exitCode = 1; }
}
