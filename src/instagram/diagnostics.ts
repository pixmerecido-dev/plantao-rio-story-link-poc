import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { InstagramDriver } from './InstagramDriver.js';

export async function collectHierarchy(driver: InstagramDriver, stage: string): Promise<string> {
  const directory = resolve('artifacts', `${Date.now()}-${stage.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  await mkdir(directory, { recursive: true });
  const session = driver.getSession();
  await writeFile(join(directory, 'hierarchy.xml'), await session.getPageSource(), 'utf8');
  await session.saveScreenshot(join(directory, 'screen.png'));
  console.log(`Diagnóstico salvo em ${directory} (pode conter dados pessoais; não enviar ao Git).`);
  return directory;
}

export async function saveScreenArtifacts(driver: Pick<InstagramDriver, 'getSession'>, directory: string, name: string) {
  await mkdir(directory, { recursive: true });
  const session = driver.getSession();
  let source = '';
  const results = await Promise.allSettled([
    (async () => {
      source = await session.getPageSource();
      await writeFile(join(directory, `${name}.xml`), source, 'utf8');
    })(),
    session.saveScreenshot(join(directory, `${name}.png`)),
  ]);
  const { extractInstagramElements } = await import('./inspectElements.js');
  let elements: ReturnType<typeof extractInstagramElements> = [];
  try {
    elements = extractInstagramElements(source);
    await writeFile(join(directory, `${name}.json`), `${JSON.stringify(elements, null, 2)}\n`, 'utf8');
  } catch (error: unknown) {
    results.push({ status: 'rejected', reason: error });
  }
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), `Falha na captura ${name}`);
  console.log(`Captura: ${join(directory, name)}.xml / .png / .json`);
  return { source, elements };
}
