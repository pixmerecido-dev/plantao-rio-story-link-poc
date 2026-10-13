import "dotenv/config";
import { localAccountDetector } from "./accountVerification.js";
const detection = await localAccountDetector()();
console.log(JSON.stringify(detection, null, 2));
console.log(
  "[SAFE] verificação do próprio perfil; nenhum Story criado/publicado.",
);
if (detection.status !== "OK") process.exitCode = 2;
