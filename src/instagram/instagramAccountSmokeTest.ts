import "dotenv/config";
import { resolve } from "node:path";
import { OperationsStorage } from "../admin/operationsStorage.js";
import { InstagramAccountService } from "../admin/instagramAccountService.js";
import { DEFAULT_ACCOUNT_ID } from "../admin/operationsDomain.js";
import { localAccountDetector } from "./accountVerification.js";

const store = new OperationsStorage(
  resolve(process.env.ADMIN_DATA_DIR ?? "data/admin", "operations.json"),
);
const service = new InstagramAccountService(store, localAccountDetector());
try {
  const expected = await service.getExpectedAccount(DEFAULT_ACCOUNT_ID);
  if (!expected?.expected_username)
    throw Error("Cadastre a conta esperada no painel antes de verificar.");
  const result = await service.detectCurrentAccount(DEFAULT_ACCOUNT_ID);
  console.log(`[ACCOUNT] Conta esperada: @${result.expected_username}`);
  console.log(
    `[ACCOUNT] Conta detectada: ${result.detected_username ? "@" + result.detected_username : "não confirmada"}`,
  );
  console.log(
    result.status === "OK"
      ? "[OK] Conta confirmada; resultado salvo no painel."
      : "[SAFE] Publicação bloqueada até a confirmação da conta do Instagram.",
  );
  if (result.status !== "OK") process.exitCode = 2;
} catch (error) {
  console.error("[FAIL] Não foi possível verificar agora:", error);
  process.exitCode = 1;
}
console.log("[SAFE] Nenhum Story criado; nenhuma publicação executada.");
