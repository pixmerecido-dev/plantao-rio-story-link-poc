import 'dotenv/config';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { InstagramDriver } from './InstagramDriver.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { detectInstagramState, reachStoryCreation, resourceIdSelector, STORY_ID, waitForClickable } from './storyFlowInspection.js';
import { extractInstagramElements, type InstagramElement } from './inspectElements.js';
import { isNamedMedia, isUnsafeMediaControl, observedImageCandidates, selectorForObservedElement } from './storyMediaInspection.js';

const runFile = promisify(execFile);
const WAIT = { timeout: 20_000, interval: 500 };
type ObservedTarget = { target: Awaited<ReturnType<ReturnType<InstagramDriver['getSession']>['$']>>; selector: string };

/** Só prepara rascunho; nenhuma operação de publicação está implementada. */
export class StoryLinkPublisher {
  constructor(private readonly driver: InstagramDriver) {}

  async findExistingTestImage(localReference: string): Promise<string> {
    const reference = await readFile(resolve(localReference));
    const expectedHash = createHash('sha256').update(reference).digest('hex');
    const adb = process.env.ADB_PATH || 'adb';
    const listing = await runFile(adb, ['-s', 'emulator-5554', 'shell', 'ls', '-1', '/sdcard/Pictures/PlantaoRio/'], { timeout: 30_000, windowsHide: true });
    const names = listing.stdout.split(/\r?\n/).map(name => name.trim())
      .filter(name => /^plantao-story-\d+\.jpg$/.test(name))
      .sort((a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]));
    for (const name of names.slice(0, 20)) {
      const result = await runFile(adb, ['-s', 'emulator-5554', 'exec-out', 'cat', `/sdcard/Pictures/PlantaoRio/${name}`],
        { timeout: 30_000, windowsHide: true, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
      if (createHash('sha256').update(result.stdout).digest('hex') === expectedHash) {
        console.log(`Mídia mais recente com SHA-256 igual à imagem local: ${name}`);
        return name;
      }
    }
    throw new Error('Nenhum dos 20 JPEGs recentes da POC corresponde à imagem local. Não selecionar mídia desconhecida.');
  }
  async prepareImage(imagePath: string): Promise<string> {
    if (process.env.DRY_RUN !== 'true') throw new Error('Esta etapa exige DRY_RUN=true; a variável não será alterada.');
    const localPath = resolve(imagePath);
    const bytes = await readFile(localPath);
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new Error('A imagem deve ser um arquivo JPEG válido.');
    }
    const filename = `plantao-story-${Date.now()}.jpg`;
    const destination = `/sdcard/Pictures/PlantaoRio/${filename}`;
    const adb = process.env.ADB_PATH || 'adb';
    const options = { timeout: 30_000, windowsHide: true };
    // execFile usa argumentos separados: caminhos Windows com espaços são suportados.
    await runFile(adb, ['-s', 'emulator-5554', 'shell', 'mkdir', '-p', '/sdcard/Pictures/PlantaoRio'], options);
    await runFile(adb, ['-s', 'emulator-5554', 'push', localPath, destination], options);
    const result = await runFile(adb, ['-s', 'emulator-5554', 'shell', 'am', 'broadcast',
      '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${destination}`], options);
    console.log(`Imagem enviada: ${destination}\n${result.stdout.trim()}`);
    return filename;
  }


  private async uniqueVisible(element: InstagramElement) {
    const selector = selectorForObservedElement(element);
    if (!selector || isUnsafeMediaControl(element)) return undefined;
    const session = this.driver.getSession();
    const matches = await session.$$(selector);
    if (matches.length !== 1) return undefined;
    // Trabalha com elemento único após verificar a cardinalidade, sem indexar coleção.
    const target = await session.$(selector);
    if (!(await target.isDisplayed()) || !(await target.isEnabled()) ||
        await target.getAttribute('clickable') !== 'true') return undefined;
    return { target, selector };
  }

  async loadImageIntoStory(filename: string, directory: string): Promise<void> {
    if (process.env.DRY_RUN !== 'true') throw new Error('Esta etapa exige DRY_RUN=true.');
    const session = this.driver.getSession();
    const state = await detectInstagramState(session);
    console.log(`[1] Estado atual detectado: ${state}`);
    await reachStoryCreation(session, state, () => {});
    const story = await session.$(resourceIdSelector(STORY_ID));
    await waitForClickable(session, story);
    console.log(`[2] STORY encontrado: ${STORY_ID}`);
    const beforeStory = await session.getPageSource();
    console.log('[3] Clicando em STORY');
    await story.click();
    // A mudança pode abrir a câmera em algumas versões: só o operador/uma mídia
    // identificada pode confirmar que estamos realmente no seletor de mídia.
    await session.waitUntil(async () => await session.getPageSource() !== beforeStory, {
      ...WAIT, timeoutMsg: 'A tela não mudou após clicar em STORY.',
    });
    await session.pause(1_000);
    let picker = await saveScreenArtifacts(this.driver, directory, 'step-03-media-picker');
    let input: ReturnType<typeof createInterface> | undefined;
    const ask = async (question: string): Promise<string> => {
      if (!stdin.isTTY || !stdout.isTTY) throw new Error('Fallback exige terminal local interativo. Consulte XML/PNG/JSON; nenhuma mídia foi escolhida automaticamente.');
      input ??= createInterface({ input: stdin, output: stdout });
      return (await input.question(question)).trim();
    };
    let confirmation = '';
    let selectedSelector: string | undefined;
    try {
      let named = picker.elements.filter(element => isNamedMedia(element, filename));
      if (named.length === 0) {
        console.log('Nome/caminho da imagem não foi exposto. Confira a screenshot; STORY pode ter aberto a câmera.');
        if (await ask('Abra manualmente SOMENTE a galeria do Story se necessário, sem selecionar mídia. Digite GALERIA quando o seletor estiver aberto: ') !== 'GALERIA') throw new Error('Seletor de mídia não confirmado; interrompido.');
        picker = await saveScreenArtifacts(this.driver, directory, 'step-04-gallery-confirmed');
        named = picker.elements.filter(element => isNamedMedia(element, filename));
      }
      console.log('[4] Seletor de mídia aberto (mídia nomeada observada ou confirmação local)');
      const namedTargets: ObservedTarget[] = [];
      for (const element of named) {
        const candidate = await this.uniqueVisible(element);
        if (candidate && !namedTargets.some(item => item.selector === candidate.selector)) namedTargets.push(candidate);
      }
      if (namedTargets.length === 1) {
        for (const candidate of namedTargets) {
          await candidate.target.waitForExist(WAIT);
          await candidate.target.waitForDisplayed(WAIT);
          console.log(`[5] Imagem de teste identificada pelo nome e hash: ${filename}`);
          const fresh = extractInstagramElements(await session.getPageSource());
          if (!fresh.some(element => isNamedMedia(element, filename) && selectorForObservedElement(element) === candidate.selector)) throw new Error('Mídia nomeada mudou antes do clique.');
          selectedSelector = candidate.selector;
          await candidate.target.click();
        }
      } else {
        console.log(`Sem miniatura nomeada inequívoca. Arquivo validado: ${filename}. Não presumir que a primeira miniatura é a POC.`);
        const candidates = [];
        for (const element of observedImageCandidates(picker.elements)) {
          const candidate = await this.uniqueVisible(element);
          if (candidate) candidates.push({ ...candidate, element });
        }
        candidates.forEach((candidate, index) => console.log(`${index + 1}. ${JSON.stringify(candidate.element)}\n   ${candidate.selector}`));
        const choice = await ask('Compare a miniatura com assets/story-test.jpg. Escolha um número, ou digite MANUAL se nenhum seletor for confiável (Enter cancela): ');
        if (choice === 'MANUAL') {
          if (await ask(`Selecione MANUALMENTE apenas a imagem de teste no emulador. Digite SELECIONADA ${filename} após vê-la no editor: `) !== `SELECIONADA ${filename}`) throw new Error('Seleção manual não confirmada.');
          confirmation = 'seleção manual confirmada pelo operador, sem seletor confiável';
          console.log('[5] Imagem de teste identificada pelo operador');
        } else {
          if (!/^\d+$/.test(choice)) throw new Error('Seleção cancelada; nenhuma miniatura clicada.');
          const candidate = candidates.find((_, index) => index + 1 === Number(choice));
          if (!candidate) throw new Error('Escolha fora da lista; nenhuma miniatura clicada.');
          if (await ask(`Confirme visualmente que esta miniatura é a POC digitando ${filename}: `) !== filename) throw new Error('Identidade da miniatura não confirmada.');
          const current = extractInstagramElements(await session.getPageSource());
          if (!current.some(element => JSON.stringify(element) === JSON.stringify(candidate.element))) throw new Error('A miniatura mudou; clique cancelado.');
          const fresh = await this.uniqueVisible(candidate.element);
          if (!fresh) throw new Error('Seletor não é mais único/visível; clique cancelado.');
          selectedSelector = fresh.selector;
          console.log('[5] Imagem de teste identificada por confirmação visual e seletor observado');
          await fresh.target.click();
          confirmation = 'miniatura identificada visualmente pelo operador';
        }
      }
      console.log('[6] Imagem selecionada');
      await session.waitUntil(async () => await session.getPageSource() !== picker.source, {
        ...WAIT, timeoutMsg: 'A galeria não mudou após selecionar a imagem; não confirmar editor.',
      });
      await session.pause(1_000);
      await saveScreenArtifacts(this.driver, directory, 'step-05-editor-candidate');
      // Não há ID real de editor confirmado. Não usar mudança de XML como prova.
      if (await ask(`Confira a tela: a imagem de teste está no EDITOR do Story, sem publicá-la? Digite EDITOR ${filename}: `) !== `EDITOR ${filename}`) {
        throw new Error('Editor/preview não confirmados; não declarar sucesso.');
      }
      if (await session.getCurrentPackage() !== 'com.instagram.android') throw new Error('Instagram não está em primeiro plano.');
      await saveScreenArtifacts(this.driver, directory, 'step-06-editor-confirmed');
      console.log('[7] Editor do Story confirmado (visualmente pelo operador)');
      await writeFile(join(directory, 'summary.json'), `${JSON.stringify({ filename, storyId: STORY_ID, selectedSelector,
        mediaIdentity: confirmation || 'nome observado e hash do arquivo validado', editorConfirmation: 'visual pelo operador', published: false }, null, 2)}\n`, 'utf8');
      console.log('[8] Pronto para próxima etapa');
    } finally { input?.close(); }
  }
}
