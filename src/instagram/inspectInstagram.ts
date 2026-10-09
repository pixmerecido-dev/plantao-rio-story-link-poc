import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { InstagramDriver } from './InstagramDriver.js';
import { extractInstagramElements } from './inspectElements.js';

const driver = new InstagramDriver();

try {
  console.log('[1/4] Conectando ao Appium e ao emulator-5554');
  await driver.checkAppium();
  await driver.connect();
  console.log('[2/4] Abrindo Instagram com a sessão existente');
  await driver.openAndConfirmInstagram();
  console.log('[3/4] Capturando page source/hierarchy');
  const source = await driver.getSession().getPageSource();
  await mkdir(resolve('artifacts'), { recursive: true });
  const sourcePath = resolve('artifacts/instagram-page-source.xml');
  const elementsPath = resolve('artifacts/instagram-elements.json');
  // Substitui somente os dois relatórios fixos a cada inspeção bem-sucedida.
  const elements = extractInstagramElements(source);
  await writeFile(sourcePath, source, 'utf8');
  await writeFile(elementsPath, `${JSON.stringify(elements, null, 2)}\n`, 'utf8');
  console.log(`[4/4] ${elements.length} elementos encontrados`);
  console.log('Os relatórios e os atributos abaixo podem conter dados pessoais. Não enviar ao Git.');
  for (const [index, element] of elements.entries()) {
    console.log(`${index + 1}. ${JSON.stringify(element)}`);
  }
  console.log(`Hierarquia: ${sourcePath}\nResumo: ${elementsPath}`);
  if (elements.length === 0) console.warn('Nenhum atributo relevante encontrado; confira a hierarquia capturada.');
} catch (error: unknown) {
  console.error('Falha ao inspecionar Instagram; relatórios anteriores não representam esta execução:', error);
  process.exitCode = 1;
} finally {
  try {
    await driver.disconnect();
  } catch (error: unknown) {
    console.error('Falha ao encerrar apenas a sessão Appium:', error);
    process.exitCode = 1;
  }
}
