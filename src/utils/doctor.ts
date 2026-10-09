import { inspectEnvironment } from '../config/environment.js';

const check = inspectEnvironment();
console.log('plantao-rio-story-link-poc — relatório do ambiente');
console.log(`Node.js: ${process.version}`);
console.log(`Plataforma: ${process.platform} (${process.arch})`);
console.log(`DRY_RUN: ${!check.present ? 'ausente' : check.valid ? 'presente e válida' : 'inválida (use true ou false)'}`);
console.log('ADB, Appium, emulador e Instagram: não consultados nesta etapa.');
console.log('Nenhuma senha ou outro segredo é exibido.');
console.log(`Resultado: ${check.valid ? 'OK' : 'configuração pendente; copie .env.example para .env e configure DRY_RUN.'}`);
process.exitCode = check.valid ? 0 : 1;
