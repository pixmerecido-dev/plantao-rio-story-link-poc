import { InstagramDriver } from './InstagramDriver.js';
import { collectHierarchy } from './diagnostics.js';

const driver = new InstagramDriver();
try {
  await driver.checkAppium();
  await driver.connect();
  // Não navega: coleta a tela que o usuário deixou aberta manualmente.
  await collectHierarchy(driver, 'manual');
} catch (error: unknown) {
  console.error('Falha no diagnóstico:', error);
  process.exitCode = 1;
} finally {
  try { await driver.disconnect(); }
  catch (error: unknown) { console.error('Falha ao encerrar sessão:', error); process.exitCode = 1; }
}
