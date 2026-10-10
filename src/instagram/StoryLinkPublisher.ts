import 'dotenv/config';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { InstagramDriver } from './InstagramDriver.js';
import { saveScreenArtifacts } from './diagnostics.js';
import { navigateToStoryEditor, STORY_ID } from './instagramStateMachine.js';
import { selectFirstVisiblePhoto, waitForGalleryExit } from './storyGallery.js';

const runFile = promisify(execFile);

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


  async loadImageIntoStory(localReference: string, directory: string): Promise<void> {
    let filename: string | undefined;
    let selected: Awaited<ReturnType<typeof selectFirstVisiblePhoto>> | undefined;
    const session = this.driver.getSession();
    const result = await navigateToStoryEditor(session, async () => {
      // Só requer ADB/arquivo local quando realmente vai selecionar uma imagem.
      await saveScreenArtifacts(this.driver, directory, 'gallery');
      filename = await this.findExistingTestImage(localReference);
      selected = await selectFirstVisiblePhoto(session);
      await waitForGalleryExit(session);
    });
    await saveScreenArtifacts(this.driver, directory, 'editor');
    await writeFile(join(directory, 'summary.json'), `${JSON.stringify({ ...result, filename, storyId: STORY_ID, selected,
      reusedExistingDraft: result.initialState === 'STATE_EDITOR' || result.initialState === 'STATE_EDITOR_WITH_LINK',
      editorConfirmation: 'marcador real do editor visível e Instagram em primeiro plano', published: false }, null, 2)}\n`, 'utf8');
  }
}
