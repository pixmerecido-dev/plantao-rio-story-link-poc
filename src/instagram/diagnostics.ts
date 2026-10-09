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
