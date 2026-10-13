import { mkdir, open, readFile, unlink, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
export function isProcessAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
/** Atomic per-device inter-process lease. Unknown/corrupt owners fail closed. */
export async function acquireDeviceLock(
  device = "emulator-5554",
  directory = resolve(process.env.ADMIN_DATA_DIR ?? "data/admin"),
) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(device)) throw Error("Dispositivo inválido.");
  const filename = resolve(directory, `device-${device}.lock`),
    token = randomUUID();
  await mkdir(dirname(filename), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(filename, "wx", 0o600);
      await file.writeFile(
        JSON.stringify({
          pid: process.pid,
          token,
          started_at: new Date().toISOString(),
        }),
      );
      await file.close();
      return async () => {
        const owner = JSON.parse(await readFile(filename, "utf8"));
        if (owner.token === token) await unlink(filename);
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const reclaimFile = `${filename}.reclaim`;
      let claim;
      try {
        claim = await open(reclaimFile, "wx", 0o600);
      } catch {
        throw Error("Outra execução está conferindo a trava; aguarde.");
      }
      try {
        let owner;
        try {
          owner = JSON.parse(await readFile(filename, "utf8"));
        } catch {
          throw Error("Trava do dispositivo precisa de revisão.");
        }
        if (
          !Number.isSafeInteger(owner.pid) ||
          !owner.token ||
          isProcessAlive(owner.pid)
        )
          throw Error("Dispositivo ocupado por outra execução.");
        const stale = `${filename}.${randomUUID()}.stale`;
        await rename(filename, stale);
        await unlink(stale);
      } finally {
        await claim.close();
        await unlink(reclaimFile);
      }
    }
  }
  throw Error("Dispositivo ocupado.");
}

export async function isDeviceOccupied(
  directory: string,
  device = "emulator-5554",
) {
  try {
    const owner = JSON.parse(
      await readFile(resolve(directory, `device-${device}.lock`), "utf8"),
    );
    return !Number.isSafeInteger(owner.pid) || isProcessAlive(owner.pid);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}
