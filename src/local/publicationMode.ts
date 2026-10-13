import { readFileSync } from "node:fs";
import { resolve } from "node:path";
/** Applies to legacy real CLI too: a persisted Test Mode cannot be bypassed by env opt-ins. */
export function assertNotInTestMode(env: NodeJS.ProcessEnv = process.env) {
  let testMode = env.STORY_TEST_MODE !== "false";
  try {
    const state = JSON.parse(
      readFileSync(
        resolve(env.ADMIN_DATA_DIR ?? "data/admin", "runtime.json"),
        "utf8",
      ),
    ) as { version?: number; config?: { test_mode?: boolean } };
    if (state.version !== 1 || typeof state.config?.test_mode !== "boolean")
      throw Error("Configuração inválida.");
    testMode = state.config.test_mode || testMode;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw Error("Publicação bloqueada: configuração local exige revisão.");
  }
  if (testMode) {
    console.log("[SAFE] Modo Teste ativo; publicação bloqueada.");
    throw Error("Modo Teste ativo. Nenhum Story pode ser publicado.");
  }
}
