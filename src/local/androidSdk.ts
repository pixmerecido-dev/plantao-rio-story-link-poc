import { access, readFile } from "node:fs/promises";
import { resolve, join, isAbsolute } from "node:path";
export async function findAndroidSdk(
  root: string,
  saved: string,
  env = process.env,
  platform = process.platform,
) {
  const candidates = [saved];
  // Never scan the whole disk. A sibling Android project can supply an explicit properties path.
  for (const filename of [
    join(root, "local.properties"),
    env.ANDROID_LOCAL_PROPERTIES,
  ])
    if (filename) {
      try {
        const text = await readFile(filename, "utf8");
        const line = text.match(/^sdk\.dir\s*=\s*(.+)$/m)?.[1];
        if (line) candidates.push(line.trim().replace(/\\([\\:= ])/g, "$1"));
      } catch {
        /* optional */
      }
    }
  if (platform === "win32" && env.LOCALAPPDATA)
    candidates.push(join(env.LOCALAPPDATA, "Android", "Sdk"));
  if (env.HOME && platform !== "win32")
    candidates.push(
      join(env.HOME, "Android", "Sdk"),
      join(env.HOME, "Library", "Android", "sdk"),
    );
  candidates.push(env.ANDROID_HOME ?? "", env.ANDROID_SDK_ROOT ?? "");
  for (const candidate of candidates.filter(Boolean)) {
    const sdk = resolve(candidate);
    const adb = join(
        sdk,
        "platform-tools",
        platform === "win32" ? "adb.exe" : "adb",
      ),
      emulator = join(
        sdk,
        "emulator",
        platform === "win32" ? "emulator.exe" : "emulator",
      );
    try {
      await access(adb);
      await access(emulator);
      return { sdk, adb, emulator };
    } catch {
      /* next */
    }
  }
  throw Error(
    "Android não encontrado. O administrador deve selecionar a pasta do Android SDK.",
  );
}
export function validateRuntimeConfig(input: Record<string, unknown>) {
  if (
    input.sdk_path !== undefined &&
    (typeof input.sdk_path !== "string" ||
      (input.sdk_path !== "" && !isAbsolute(input.sdk_path)))
  )
    throw Error("Pasta Android deve ser um caminho absoluto.");
  if (
    input.avd !== undefined &&
    (typeof input.avd !== "string" ||
      (input.avd !== "" && !/^[A-Za-z0-9_.-]+$/.test(input.avd)))
  )
    throw Error("Nome do emulador inválido.");
  if (
    input.account_ttl_seconds !== undefined &&
    (!Number.isInteger(input.account_ttl_seconds) ||
      Number(input.account_ttl_seconds) < 30 ||
      Number(input.account_ttl_seconds) > 3600)
  )
    throw Error("Validade deve ficar entre 30 e 3600 segundos.");
  if (input.test_mode !== undefined && input.test_mode !== true)
    throw Error("Modo Teste deve permanecer ativo nesta etapa.");
}
