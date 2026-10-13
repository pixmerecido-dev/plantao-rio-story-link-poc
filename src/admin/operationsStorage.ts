import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  initialOperationsState,
  validateOperationsState,
  type OperationsState,
} from "./operationsDomain.js";
export interface OperationsRepository {
  read(): Promise<OperationsState>;
  transact<T>(action: (state: OperationsState) => T): Promise<T>;
}
/** One backend owns this local store; all decisions and transitions share one atomic transaction. */
export class OperationsStorage implements OperationsRepository {
  private state!: OperationsState;
  private ready: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private filename: string) {
    this.ready = this.load();
  }
  private async load() {
    await mkdir(dirname(this.filename), { recursive: true });
    try {
      const s = JSON.parse(
        await readFile(this.filename, "utf8"),
      ) as OperationsState;
      validateOperationsState(s);
      this.state = s;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error("Armazenamento operacional inválido; arquivo preservado.", {
          cause: e,
        });
      this.state = initialOperationsState();
      await this.persist(this.state);
    }
  }
  private async persist(s: OperationsState) {
    const temp = `${this.filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
      await rename(temp, this.filename);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  async read() {
    await this.ready;
    await this.tail;
    return structuredClone(this.state);
  }
  transact<T>(action: (state: OperationsState) => T): Promise<T> {
    const run = this.tail.then(async () => {
      await this.ready;
      const next = structuredClone(this.state),
        result = action(next);
      validateOperationsState(next);
      await this.persist(next);
      this.state = next;
      return structuredClone(result);
    });
    this.tail = run.catch(() => {});
    return run;
  }
}
