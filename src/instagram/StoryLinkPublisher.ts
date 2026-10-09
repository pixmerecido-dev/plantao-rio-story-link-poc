import 'dotenv/config';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { InstagramDriver } from './InstagramDriver.js';
import { collectHierarchy } from './diagnostics.js';

const runFile = promisify(execFile);

type Selector = { strategy: 'accessibility id' | 'resource-id' | 'text'; value: string };
type StorySelectors = {
  openStory: Selector[];
  openGallery: Selector[];
  image: Selector;
  editorMarker: Selector;
  editorPreview: Selector;
};

function validateSelector(value: unknown): asserts value is Selector {
  if (!value || typeof value !== 'object') throw new Error('Seletor ausente.');
  const selector = value as Partial<Selector>;
  if (!['accessibility id', 'resource-id', 'text'].includes(selector.strategy ?? '') ||
      typeof selector.value !== 'string' || !selector.value.trim()) {
    throw new Error('Use um seletor real com strategy accessibility id, resource-id ou text e value não vazio.');
  }
}

async function loadSelectors(): Promise<StorySelectors> {
  const config = JSON.parse(await readFile(resolve('story-selectors.local.json'), 'utf8')) as StorySelectors;
  for (const name of ['openStory', 'openGallery'] as const) {
    if (!Array.isArray(config[name]) || config[name].length === 0) {
      throw new Error(`Configure ${name} com os passos observados na hierarquia local.`);
    }
    for (const selector of config[name]) validateSelector(selector);
  }
  for (const name of ['image', 'editorMarker', 'editorPreview'] as const) validateSelector(config[name]);
  return config;
}

/** Nesta etapa, prepara apenas um rascunho de Story. Não há operação de publicação. */
export class StoryLinkPublisher {
  constructor(private readonly driver: InstagramDriver) {}

  private async element(selector: Selector, filename = '') {
    const value = selector.value.replaceAll('{{filename}}', filename);
    const expression = selector.strategy === 'accessibility id' ? `~${value}` :
      `android=new UiSelector().${selector.strategy === 'resource-id' ? 'resourceId' : 'text'}(${JSON.stringify(value)})`;
    return this.driver.getSession().$(expression);
  }

  private async click(selector: Selector, filename = ''): Promise<void> {
    const element = await this.element(selector, filename);
    await element.waitForDisplayed({ timeout: 15_000 });
    // Um seletor ambíguo não pode escolher silenciosamente o primeiro resultado.
    const matches = await this.driver.getSession().$$(element.selector);
    if (matches.length !== 1) throw new Error(`Seletor ambíguo: ${selector.value} (${matches.length} resultados).`);
    const labels = [selector.value, await element.getText(), await element.getAttribute('content-desc'),
      await element.getAttribute('resource-id')].join(' ').replace(/[_-]/g, ' ');
    if (/\b(share|sharing|publish|post|send|compartilhar|publicar|enviar)\b/i.test(labels)) {
      throw new Error('Controle de publicação/compartilhamento bloqueado nesta etapa.');
    }
    await element.click();
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

  async loadImageIntoStory(filename: string): Promise<void> {
    if (process.env.DRY_RUN !== 'true') throw new Error('Esta etapa exige DRY_RUN=true.');
    let stage = 'seletores';
    try {
      const selectors = await loadSelectors();
      stage = 'abrir-story';
      console.log('[4/6] Abrindo criação de Story');
      for (const selector of selectors.openStory) await this.click(selector);
      for (const selector of selectors.openGallery) await this.click(selector);
      stage = 'selecionar-imagem';
      console.log('[5/6] Selecionando imagem');
      const marker = await this.element(selectors.editorMarker);
      if (await marker.isDisplayed()) throw new Error('Marcador do editor já visível antes da seleção; revise os seletores.');
      await this.click(selectors.image, filename);
      stage = 'confirmar-editor';
      await marker.waitForDisplayed({ timeout: 20_000 });
      const preview = await this.element(selectors.editorPreview);
      await preview.waitForDisplayed({ timeout: 20_000 });
      if (await this.driver.getSession().getCurrentPackage() !== 'com.instagram.android') {
        throw new Error('Instagram não está em primeiro plano.');
      }
      await collectHierarchy(this.driver, 'editor-story');
      console.log('[6/6] Imagem carregada no editor do Story');
      // Pare aqui: nenhum sticker, URL, botão de avançar ou compartilhar.
    } catch (error: unknown) {
      try { await collectHierarchy(this.driver, stage); }
      catch (diagnosticError: unknown) { console.error('Erro ao coletar diagnóstico:', diagnosticError); }
      throw error;
    }
  }
}
