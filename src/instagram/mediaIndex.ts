import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { waitForIndexedMedia, type MediaRow } from './mediaScan.js';

const executeFile = promisify(execFile);
type AdbResult = { stdout: string; stderr: string };
type AdbRunner = (args: string[], timeout: number) => Promise<AdbResult>;
const URI = 'content://media/external/images/media';
const RELATIVE_PATH = 'Pictures/PlantaoRio/';

/** Entrada única ADB: valida, copia uma vez, solicita scan e confirma a mídia deste job. */
export async function prepareAndIndexImage(image: string, options: {
  directory?: string; runAdb?: AdbRunner; now?: () => number; pause?: (milliseconds: number) => Promise<void>;
} = {}) {
  if (process.env.DRY_RUN !== 'true') throw new Error('Esta etapa exige DRY_RUN=true; a variável não será alterada.');
  const localPath = resolve(image), bytes = await readFile(localPath);
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('STORY_IMAGE deve ser JPEG válido.');
  const now = options.now ?? Date.now, started = now();
  const filename = `plantao-story-${started}.jpg`;
  const destination = `/sdcard/${RELATIVE_PATH}${filename}`;
  const directory = options.directory ?? resolve('artifacts', `media-index-${started}`);
  const pause = options.pause ?? (milliseconds => new Promise<void>(resolveWait => setTimeout(resolveWait, milliseconds)));
  const runner: AdbRunner = options.runAdb ?? (async (args, timeout) => executeFile(process.env.ADB_PATH || 'adb', ['-s', 'emulator-5554', ...args], { timeout, windowsHide: true }));
  const commands: { args: string[]; stdout: string; stderr: string; elapsed_ms: number; error?: string }[] = [];
  const attempts: { cycle: number; attempt: number; elapsed_ms: number; found: boolean }[] = [];
  let canonicalPath: string | undefined, indexed: MediaRow | undefined, scans = 0, failure: string | undefined;
  let projection = '_id:_display_name:relative_path:_size:_data';
  await mkdir(directory, { recursive: true });
  const adb = async (args: string[], timeout = 30_000): Promise<AdbResult> => {
    try {
      const result = await runner(args, timeout);
      commands.push({ args, ...result, elapsed_ms: now() - started });
      return result;
    } catch (error) {
      const details = error as { stdout?: string; stderr?: string };
      commands.push({ args, stdout: String(details.stdout ?? ''), stderr: String(details.stderr ?? ''), elapsed_ms: now() - started, error: String(error) });
      throw error;
    }
  };
  const scan = async (path: string) => {
    scans++;
    const result = await adb(['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${path}`]);
    console.log('[MEDIA] scan solicitado');
    console.log(result.stdout.trim()); // Broadcast completed não é prova de indexação.
  };
  try {
    await adb(['shell', 'mkdir', '-p', `/sdcard/${RELATIVE_PATH}`]);
    await adb(['push', localPath, destination]);
    console.log(`[MEDIA] arquivo copiado: ${destination} (${bytes.length} bytes)`);
    console.log(`[MEDIA] imagem enviada: ${destination}`);
    await scan(destination);
    try {
      const result = await adb(['shell', 'readlink', '-f', destination], 3_000);
      const path = result.stdout.trim();
      if (/^\/(?:storage\/emulated\/\d+|sdcard)\/Pictures\/PlantaoRio\/plantao-story-\d+\.jpg$/.test(path) && path.endsWith(`/${filename}`)) {
        canonicalPath = path;
        if (path !== destination) console.log(`[MEDIA] caminho canonicalizado: ${path}`);
      }
    } catch { /* readlink é diagnóstico auxiliar; identidade usa nome/pasta/tamanho. */ }
    // Valida sintaxe/projeção no dispositivo em execução, com respostas preservadas.
    const query = async (remaining: number) => {
      const deadline = now() + remaining;
      for (;;) {
        if (now() >= deadline) return '';
        // Apenas nome gerado internamente chega ao shell/SQL; STORY_IMAGE não é interpolado.
        const command = `content query --uri ${URI} --projection ${projection} --where "_display_name='${filename}'"`;
        let result: AdbResult;
        try { result = await adb(['shell', command], Math.min(2_000, Math.max(1, deadline - now()))); }
        catch (error) {
          const details = error as { code?: string; killed?: boolean };
          if (details.code === 'ETIMEDOUT' || details.killed) {
            console.log('[MEDIA] consulta temporariamente sem resposta; polling continuará até o deadline');
            return '';
          }
          throw error;
        }
        const output = `${result.stdout}\n${result.stderr}`;
        if (/Exception|Error while|Permission Denial|Unknown column|Invalid column|no such column|syntax error|Unknown command|Unknown option|unrecognized option|content:.*not found|usage:/i.test(output)) {
          // Algumas versões não expõem _data/_size; nome e relative_path continuam obrigatórios.
          if (/(?:Invalid column|Unknown column|no such column)[^\n]*?_data\b/i.test(output) && projection.includes(':_data')) { projection = projection.replace(':_data', ''); continue; }
          if (/(?:Invalid column|Unknown column|no such column)[^\n]*?_size\b/i.test(output) && projection.includes(':_size')) { projection = projection.replace(':_size', ''); continue; }
          throw new Error(`Consulta MediaStore rejeitada pelo Android: ${output.trim()}`);
        }
        return result.stdout;
      }
    };
    for (let cycle = 1; cycle <= 2; cycle++) {
      console.log('[MEDIA] aguardando indexação no MediaStore');
      indexed = await waitForIndexedMedia({ displayName: filename, relativePath: RELATIVE_PATH, size: bytes.length }, query, pause, {
        now, timeoutMs: 15_000, intervalMs: 500,
        onAttempt: (attempt, _output, match) => attempts.push({ cycle, attempt, elapsed_ms: now() - started, found: Boolean(match) }),
      });
      if (indexed) break;
      if (cycle === 1) {
        console.log('[MEDIA] timeout: solicitando scan novamente uma única vez, sem recopiar');
        await scan(canonicalPath ?? destination);
      }
    }
    if (!indexed) throw new Error('MediaStore não confirmou a imagem deste job após dois ciclos de indexação.');
    console.log('[MEDIA] encontrado no MediaStore:', JSON.stringify(indexed));
    console.log('[MEDIA] display_name confirmado');
    console.log('[MEDIA] relative_path confirmado');
    if (indexed._size && /^\d+$/.test(indexed._size)) console.log('[MEDIA] tamanho confirmado');
    if (indexed._data && indexed._data !== destination) console.log(`[MEDIA] caminho MediaStore diferente/canonicalizado: ${indexed._data}`);
    console.log('[MEDIA] scan concluído');
    console.log('[MEDIA] mídia pronta');
    return { filename, destination, size: bytes.length, indexed, directory };
  } catch (error) {
    failure = String(error);
    throw error;
  } finally {
    await writeFile(join(directory, 'media-index.json'), `${JSON.stringify({ filename, android_path: destination, canonical_path: canonicalPath,
      local_path: localPath, size: bytes.length, display_name_confirmed: Boolean(indexed), relative_path_confirmed: Boolean(indexed),
      size_confirmed: indexed?._size !== undefined && Number(indexed._size) === bytes.length, uri: URI, projection, status: indexed ? 'INDEXED' : 'FAILED', indexed, error: failure,
      scan_requests: scans, timeout_per_cycle_ms: 15_000, polling_interval_ms: 500, elapsed_ms: now() - started, attempts, commands }, null, 2)}\n`, 'utf8');
    console.log(`Diagnóstico mídia: ${join(directory, 'media-index.json')}`);
  }
}
