import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { compareStoryOpenContexts } from './addStoryAndroidDiagnostics.js';

try {
  const [normalPath, mediaPath] = process.argv.slice(2);
  if (!normalPath || !mediaPath) throw new Error('Uso: npm run compare:story-open -- <normal/add-story-before-context.json> <with-media/add-story-before-context.json>');
  const normal = JSON.parse(await readFile(resolve(normalPath), 'utf8')) as Record<string, unknown>;
  const withMedia = JSON.parse(await readFile(resolve(mediaPath), 'utf8')) as Record<string, unknown>;
  const result = compareStoryOpenContexts(normal, withMedia);
  await mkdir(resolve('artifacts'), { recursive: true });
  const path = join(resolve('artifacts'), `story-open-comparison-${Date.now()}.json`);
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
  console.log(`Comparação: ${path}`);
} catch (error) { console.error('Falha na comparação:', error); process.exitCode = 1; }
