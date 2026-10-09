import { InstagramDriver } from './InstagramDriver.js';

const driver = new InstagramDriver();

try {
  console.log('[1/4] Conectando ao Appium em http://127.0.0.1:4723');
  await driver.checkAppium();
  console.log('[2/4] Conectando ao emulator-5554 com UiAutomator2 (noReset=true)');
  await driver.connect();
  console.log('[3/4] Abrindo Instagram');
  await driver.openAndConfirmInstagram();
  console.log('[4/4] Instagram aberto com sucesso (com.instagram.android em primeiro plano)');
} catch (error: unknown) {
  console.error('Falha no smoke test do Instagram:', error);
  process.exitCode = 1;
} finally {
  try {
    await driver.disconnect();
    console.log('Finalizado: nenhuma sessão Appium deste teste permanece aberta; dados e login preservados.');
  } catch (error: unknown) {
    console.error('Falha ao encerrar a sessão Appium:', error);
    process.exitCode = 1;
  }
}
