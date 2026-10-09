import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { InstagramDriver } from './InstagramDriver.js';
import { extractInstagramElements } from './inspectElements.js';
import { observedCreationControls, storyOptionObserved } from './storyFlowInspection.js';

const driver = new InstagramDriver();
const directory = resolve('artifacts', `story-flow-${Date.now()}`);
const clicks: { selector: string; observedElement: unknown }[] = [];
let reached = 'não iniciado';
let connected = false;
let input: ReturnType<typeof createInterface> | undefined;
let lastStep = 0;

async function capture(step: number, label: string) {
  const session = driver.getSession();
  const source = await session.getPageSource();
  const base = `instagram-step-${String(step).padStart(2, '0')}-${label}`;
  // Preserva o XML mesmo se a extração falhar.
  await writeFile(join(directory, `${base}.xml`), source, 'utf8');
  const elements = extractInstagramElements(source);
  await writeFile(join(directory, `${base}.json`), `${JSON.stringify(elements, null, 2)}\n`, 'utf8');
  await session.saveScreenshot(join(directory, `${base}.png`));
  lastStep = step;
  console.log(`Captura: ${base} (${elements.length} elementos).`);
  return elements;
}

try {
  if (process.env.DRY_RUN !== 'true') throw new Error('Este diagnóstico exige DRY_RUN=true; não altera a variável.');
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Execute em um terminal interativo local no Windows.');
  await mkdir(directory, { recursive: true });
  console.log('Conectando ao Appium e abrindo Instagram sem alterar dados/login.');
  await driver.checkAppium();
  await driver.connect();
  connected = true;
  await driver.openAndConfirmInstagram();
  input = createInterface({ input: stdin, output: stdout });
  let elements = await capture(1, 'home');
  reached = 'tela atual após ativar Instagram (não classificada)';

  for (let step = 2; step <= 4; step++) {
    if (storyOptionObserved(elements)) {
      reached = 'opção Story/Stories observada na hierarquia';
      console.log(`${reached}. Parando sem clicar na opção ou selecionar mídia.`);
      break;
    }
    const state = (await input.question('A tela atual já é o seletor de mídia do Story? [s/N] (s encerra sem clicar): ')).trim().toLowerCase();
    if (state === 's') {
      reached = 'seletor de mídia do Story, confirmado pelo operador';
      break;
    }
    const controls = observedCreationControls(elements);
    if (controls.length === 0) {
      reached = 'tela capturada sem controle de criação reconhecido; requer análise dos artefatos';
      console.log('Nenhum controle seguro reconhecido. Nenhum seletor será inventado.');
      break;
    }
    controls.forEach((control, index) => console.log(`${index + 1}. ${JSON.stringify(control.element)}\n   ${control.selector}`));
    const choice = (await input.question('Escolha o número do controle de ENTRADA de criação observado, ou Enter para parar: ')).trim();
    if (!choice) break;
    if (!/^\d+$/.test(choice)) throw new Error('Escolha inválida; nenhum clique realizado.');
    const control = controls[Number(choice) - 1];
    if (!control) throw new Error('Número fora da lista; nenhum clique realizado.');
    const confirmation = (await input.question('Confira a tela: este controle apenas ABRE criação, sem selecionar mídia/publicar? Digite ABRIR para clicar: ')).trim();
    if (confirmation !== 'ABRIR') break;
    // Reconsulta a tela: nunca clica usando apenas um seletor de captura antiga.
    const freshElements = extractInstagramElements(await driver.getSession().getPageSource());
    if (storyOptionObserved(freshElements)) {
      elements = await capture(step, 'story-option');
      reached = 'opção Story/Stories observada antes do clique; clique cancelado';
      break;
    }
    const stillPresent = observedCreationControls(freshElements).some(candidate =>
      candidate.selector === control.selector && JSON.stringify(candidate.element) === JSON.stringify(control.element));
    if (!stillPresent) throw new Error('A interface mudou; controle escolhido não está mais na hierarquia.');
    const matches = await driver.getSession().$$(control.selector);
    if (matches.length !== 1) throw new Error(`Seletor ambíguo ou ausente (${matches.length} resultados); clique cancelado.`);
    const target = matches[0]!;
    if (!(await target.isDisplayed()) || !(await target.isEnabled())) throw new Error('Controle não está visível/habilitado.');
    if (await driver.getSession().getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
    console.log(`Clicando somente no controle observado: ${control.selector}`);
    await target.click();
    clicks.push({ selector: control.selector, observedElement: control.element });
    await driver.getSession().pause(1_500);
    elements = await capture(step, 'create');
    reached = `tela após ${clicks.length} clique(s) de entrada de criação; não classificada`;
    if (storyOptionObserved(elements)) {
      reached = 'opção Story/Stories observada na hierarquia';
      break;
    }
    if (step === 4) {
      const finalState = (await input.question('A última tela é o seletor de mídia do Story? [s/N]: ')).trim().toLowerCase();
      if (finalState === 's') reached = 'seletor de mídia do Story, confirmado pelo operador';
    }
  }
  console.log(`Parado em: ${reached}. Nenhuma mídia selecionada.`);
} catch (error: unknown) {
  console.error('Falha no diagnóstico interativo:', error);
  process.exitCode = 1;
  if (connected) {
    try { await capture(lastStep + 1, 'error'); }
    catch (captureError: unknown) { console.error('Falha ao capturar tela do erro:', captureError); }
  }
} finally {
  input?.close();
  if (connected) {
    try {
      await writeFile(join(directory, 'summary.json'), `${JSON.stringify({ reached, clicks, lastStep }, null, 2)}\n`, 'utf8');
      console.log(`Artefatos locais: ${directory} (podem conter dados pessoais; ignorados pelo Git).`);
    } catch (error: unknown) { console.error('Falha ao salvar resumo:', error); process.exitCode = 1; }
  }
  try { await driver.disconnect(); }
  catch (error: unknown) { console.error('Falha ao encerrar sessão Appium:', error); process.exitCode = 1; }
}
