import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { extractInstagramElements } from './inspectElements.js';
import { HOME_CREATE_DESCRIPTION, HOME_CREATE_SELECTORS, observedCreationOptions } from './storyFlowInspection.js';

const driver = new InstagramDriver();
const directory = resolve('artifacts', `story-flow-${Date.now()}`);
let connected = false;
let reached = 'não iniciado';
let clickedSelector: string | undefined;
const foundOptions: { element: unknown; selector: string | null; exactStory: boolean }[] = [];

async function capture(base: string) {
  const session = driver.getSession();
  const source = await session.getPageSource();
  await writeFile(join(directory, `${base}.xml`), source, 'utf8');
  await session.saveScreenshot(join(directory, `${base}.png`));
  const elements = extractInstagramElements(source);
  await writeFile(join(directory, `${base}.json`), `${JSON.stringify(elements, null, 2)}\n`, 'utf8');
  console.log(`Captura salva: ${base}.xml / .png / .json`);
  return { source, elements };
}

try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Este diagnóstico exige DRY_RUN=true; não altera a variável.');
  await mkdir(directory, { recursive: true });
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  const session = driver.getSession();
  console.log('Aguardando botão de criação observado na Home.');
  let homeButton: Awaited<ReturnType<typeof session.$>> | undefined;
  for (const selector of HOME_CREATE_SELECTORS) {
    let available = false;
    try {
      await session.waitUntil(async () => {
        const matches = await session.$$(selector);
        if (matches.length > 1) throw new Error(`Botão da Home ambíguo: ${selector}`);
        const candidate = matches[0];
        if (!candidate || !(await candidate.isDisplayed()) || !(await candidate.isEnabled())) return false;
        // O ID pode ser reutilizado em outra tela: exige a descrição e classe observadas.
        if (await candidate.getAttribute('content-desc') !== HOME_CREATE_DESCRIPTION ||
            await candidate.getAttribute('class') !== 'android.widget.Button') return false;
        homeButton = candidate;
        available = true;
        return true;
      }, { timeout: 15_000, interval: 500, timeoutMsg: `Home indisponível pelo seletor ${selector}` });
    } catch (error: unknown) {
      if (selector === HOME_CREATE_SELECTORS[1]) throw error;
      console.log('Resource-id indisponível ou inseguro; tentando a descrição observada.');
    }
    if (available) { clickedSelector = selector; break; }
  }
  if (!homeButton || !clickedSelector) throw new Error('Botão de criação da Home não encontrado de forma inequívoca.');
  const home = await capture('step-01-home');
  if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
  // Revalida o alvo imediatamente antes do único clique permitido.
  if (!(await homeButton.isDisplayed()) || !(await homeButton.isEnabled()) ||
      await homeButton.getAttribute('content-desc') !== HOME_CREATE_DESCRIPTION) {
    throw new Error('Botão mudou antes do clique; operação cancelada.');
  }
  console.log(`Abrindo criação pelo seletor real: ${clickedSelector}`);
  await homeButton.click();
  reached = 'botão de criação clicado; próxima tela ainda não confirmada';
  let transitionError: unknown;
  try {
    await session.waitUntil(async () => await session.getPageSource() !== home.source, {
      timeout: 15_000, interval: 500, timeoutMsg: 'Hierarquia não mudou após clicar no botão de criação.',
    });
    // Curta espera de animação antes da captura imediata da tela seguinte.
    await session.pause(500);
  } catch (error: unknown) { transitionError = error; }
  const creation = await capture('step-02-create');
  if (transitionError) throw transitionError;
  if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('A próxima tela não pertence ao Instagram.');
  reached = 'tela após abertura de criação capturada';
  for (const option of observedCreationOptions(creation.elements)) {
    let uniqueSelector: string | null = null;
    for (const selector of option.selectors) {
      const matches = await session.$$(selector);
      if (matches.length === 1 && await matches[0]!.isDisplayed()) {
        uniqueSelector = selector;
        break;
      }
    }
    foundOptions.push({ element: option.element, selector: uniqueSelector, exactStory: option.exactStory });
    console.log(`Opção observada: ${JSON.stringify(option.element)}`);
    console.log(`Seletor: ${uniqueSelector ?? 'nenhum seletor único e visível; opção ambígua ou oculta'}`);
  }
  const stories = foundOptions.filter(option => option.exactStory && option.selector !== null);
  if (stories.length === 1) {
    reached = 'opção Story inequívoca e visível encontrada; nenhum clique na opção';
    console.log(`Story: ${stories[0]!.selector}`);
  } else {
    console.log(`Story ainda não identificado de forma inequívoca (${stories.length} opções únicas visíveis). Revise step-02-create.`);
  }
  console.log(`Parado: ${reached}. Não selecionou imagem nem publicou.`);
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
      await writeFile(join(directory, 'summary.json'), `${JSON.stringify({ reached, clickedSelector, foundOptions }, null, 2)}\n`, 'utf8');
      console.log(`Artefatos: ${directory} (podem conter dados pessoais; ignorados pelo Git).`);
    } catch (error: unknown) { console.error('Falha ao salvar resumo:', error); process.exitCode = 1; }
  }
  try { await driver.disconnect(); }
  catch (error: unknown) { console.error('Falha ao encerrar sessão Appium:', error); process.exitCode = 1; }
}
