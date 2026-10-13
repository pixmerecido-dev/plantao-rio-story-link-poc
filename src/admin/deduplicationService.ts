import { createHash } from "node:crypto";
import type { OperationsState } from "./operationsDomain.js";
export class DeduplicationService {
  static key(account: string, url: string, hash: string) {
    return createHash("sha256")
      .update(JSON.stringify([account, url, hash]))
      .digest("hex");
  }
  static exists(s: OperationsState, key: string) {
    return s.queue.some(
      (j) =>
        j.dedup_key === key &&
        j.status !== "CANCELLED" &&
        j.status !== "DUPLICATE",
    );
  }
}
