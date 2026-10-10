import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareAndIndexImage } from '../dist/instagram/mediaIndex.js';
import { findIndexedMedia, waitForIndexedMedia } from '../dist/instagram/mediaScan.js';

const previous = process.env.DRY_RUN;
process.env.DRY_RUN = 'true';
after(() => { if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous; });
const identity = { displayName: 'this-job.jpg', relativePath: 'Pictures/PlantaoRio/', size: 4 };
const row = (overrides = '') => `Row: 0 _id=12, _display_name=this-job.jpg, relative_path=Pictures/PlantaoRio/, _size=4, _data=/storage/emulated/0/Pictures/PlantaoRio/this-job.jpg${overrides}`;

test('nome/pasta/tamanho confirmam mídia com caminho canonicalizado', () => {
  assert.equal(findIndexedMedia(row(), identity)?._id, '12');
  assert.equal(findIndexedMedia(row().replace('Pictures/PlantaoRio/', 'Pictures/Other/'), identity), undefined);
  assert.equal(findIndexedMedia(row().replace('_size=4', '_size=999'), identity), undefined);
  assert.equal(findIndexedMedia(row().replace('_display_name=this-job.jpg', '_display_name=old.jpg'), identity), undefined);
  assert.equal(findIndexedMedia('Broadcast completed: result=0', identity), undefined);
  assert.equal(findIndexedMedia(`${row()}\n${row().replace('_id=12', '_id=13')}`, identity), undefined);
  assert.equal(findIndexedMedia(row().replace('_size=4, ', ''), identity)?._id, '12');
});
async function fixture({ ready = 'initial', incompatible = false, sizeUnsupported = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'media-index-'));
  const image = join(directory, 'local image.jpg');
  await writeFile(image, Buffer.from([0xff, 0xd8, 0xff, 1]));
  let clock = 1000, scans = 0, queries = 0;
  const commands = [];
  const runner = async (args, timeout) => {
    assert.ok(timeout > 0 && timeout <= 30000);
    commands.push(args);
    if (args[0] === 'push') return { stdout: '1 file pushed', stderr: '' };
    if (args.includes('broadcast')) { scans++; return { stdout: 'Broadcast completed: result=0', stderr: '' }; }
    if (args.includes('readlink')) return { stdout: '/storage/emulated/0/Pictures/PlantaoRio/plantao-story-1000.jpg\n', stderr: '' };
    if (args[1]?.startsWith('content query')) {
      queries++; clock += 1;
      assert.ok(args[1].includes(`--where "_display_name='plantao-story-1000.jpg'"`));
      assert.ok(!args[1].includes("--where \"_data="));
      if (incompatible && args[1].includes(':_data')) return { stdout: '', stderr: 'java.lang.IllegalArgumentException: Invalid column _data' };
      if (sizeUnsupported && args[1].includes(':_size')) return { stdout: '', stderr: 'java.lang.IllegalArgumentException: Invalid column _size' };
      const found = ready === 'initial' && queries > 1 || ready === 'fallback' && scans === 2;
      return { stdout: found ? `Row: 0 _id=7, _display_name=plantao-story-1000.jpg, relative_path=Pictures/PlantaoRio/, ${sizeUnsupported ? '' : '_size=4, '}_data=/storage/emulated/0/Pictures/PlantaoRio/plantao-story-1000.jpg` : 'No result found.', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  return { image, directory, commands, options: { directory, runAdb: runner, now: () => clock, pause: async ms => { clock += ms; } }, get scans() { return scans; }, get queries() { return queries; } };
}
test('copia uma vez e só aceita scan após consultar mídia deste job', async () => {
  const mock = await fixture();
  const result = await prepareAndIndexImage(mock.image, mock.options);
  assert.equal(result.filename, 'plantao-story-1000.jpg');
  assert.equal(result.indexed._id, '7');
  assert.equal(mock.scans, 1);
  assert.equal(mock.commands.filter(args => args[0] === 'push').length, 1);
  const report = JSON.parse(await readFile(join(mock.directory, 'media-index.json'), 'utf8'));
  assert.equal(report.status, 'INDEXED'); assert.equal(report.size, 4);
  assert.equal(report.canonical_path, '/storage/emulated/0/Pictures/PlantaoRio/plantao-story-1000.jpg');
  assert.ok(report.commands.some(command => command.stdout === 'No result found.'));
  assert.ok(report.elapsed_ms > 0);
});
test('um timeout solicita apenas um novo scan canonicalizado, sem recopiar', async () => {
  const mock = await fixture({ ready: 'fallback' });
  await prepareAndIndexImage(mock.image, mock.options);
  assert.equal(mock.scans, 2);
  assert.equal(mock.commands.filter(args => args[0] === 'push').length, 1);
  const scans = mock.commands.filter(args => args.includes('broadcast'));
  assert.equal(scans[1].at(-1), 'file:///storage/emulated/0/Pictures/PlantaoRio/plantao-story-1000.jpg');
  const report = JSON.parse(await readFile(join(mock.directory, 'media-index.json'), 'utf8'));
  assert.ok(report.elapsed_ms >= 15000);
  assert.equal(report.scan_requests, 2);
});
test('falha após dois ciclos conserva consultas/tempo e não copia novamente', async () => {
  const mock = await fixture({ ready: 'never' });
  await assert.rejects(prepareAndIndexImage(mock.image, mock.options), /após dois ciclos/);
  assert.equal(mock.scans, 2);
  assert.equal(mock.commands.filter(args => args[0] === 'push').length, 1);
  const report = JSON.parse(await readFile(join(mock.directory, 'media-index.json'), 'utf8'));
  assert.equal(report.status, 'FAILED');
  assert.ok(report.elapsed_ms >= 30000 && report.elapsed_ms < 30100);
  assert.ok(report.commands.filter(command => command.args[1]?.startsWith('content query')).length > 2);
});
test('valida projeção no Android e adapta colunas opcionais sem relaxar nome/pasta', async () => {
  const mock = await fixture({ incompatible: true, sizeUnsupported: true });
  await prepareAndIndexImage(mock.image, mock.options);
  const report = JSON.parse(await readFile(join(mock.directory, 'media-index.json'), 'utf8'));
  assert.equal(report.projection, '_id:_display_name:relative_path');
  assert.equal(report.status, 'INDEXED');
  assert.ok(report.commands.some(command => /Invalid column/.test(command.stderr)));
});
test('erro de provider não vira sucesso nem dispara recópia', async () => {
  const mock = await fixture();
  const runner = mock.options.runAdb;
  mock.options.runAdb = async (args, timeout) => args[1]?.startsWith('content query') ? { stdout: 'Permission Denial: media provider', stderr: '' } : runner(args, timeout);
  await assert.rejects(prepareAndIndexImage(mock.image, mock.options), /Consulta MediaStore rejeitada/);
  assert.equal(mock.scans, 1);
  assert.equal(JSON.parse(await readFile(join(mock.directory, 'media-index.json'), 'utf8')).status, 'FAILED');
});
test('polling respeita deadline de 15 segundos e intervalos de 500ms', async () => {
  let clock = 0, queries = 0;
  const match = await waitForIndexedMedia(identity, async remaining => { assert.ok(remaining > 0); queries++; clock += 100; return 'No result found.'; }, async ms => { assert.ok(ms <= 500); clock += ms; }, { now: () => clock });
  assert.equal(match, undefined); assert.equal(clock, 15000); assert.equal(queries, 25);
});

test('consulta individual com timeout não confirma mídia e permite aguardar até o deadline', async () => {
  const mock = await fixture();
  const runner = mock.options.runAdb;
  let timedOut = false;
  mock.options.runAdb = async (args, timeout) => {
    if (!timedOut && args[1]?.startsWith('content query')) {
      timedOut = true;
      const error = new Error('query timed out'); error.code = 'ETIMEDOUT';
      throw error;
    }
    return runner(args, timeout);
  };
  await prepareAndIndexImage(mock.image, mock.options);
  const report = JSON.parse(await readFile(join(mock.directory, 'media-index.json'), 'utf8'));
  assert.equal(report.status, 'INDEXED');
  assert.equal(report.scan_requests, 1);
  assert.ok(report.commands.some(command => /timed out/.test(command.error ?? '')));
});
