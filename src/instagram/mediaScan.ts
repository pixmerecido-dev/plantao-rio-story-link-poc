export type MediaIdentity = { displayName: string; relativePath: string; size: number };
export type MediaRow = Record<string, string>;

export function findIndexedMedia(output: string, expected: MediaIdentity): MediaRow | undefined {
  const matches: MediaRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!/^Row:\s*\d+\s+/.test(line.trim())) continue;
    const row: MediaRow = {};
    for (const field of line.replace(/^\s*Row:\s*\d+\s+/, '').split(/,\s*/)) {
      const separator = field.indexOf('=');
      if (separator >= 0) row[field.slice(0, separator).trim()] = field.slice(separator + 1).trim();
    }
    if (!/^\d+$/.test(row._id ?? '') || row._display_name !== expected.displayName) continue;
    const relative = row.relative_path?.replace(/^\/+|\/+$/g, '');
    const folder = expected.relativePath.replace(/^\/+|\/+$/g, '');
    if (!relative || !(relative === folder || relative.endsWith(`/${folder}`))) continue;
    // Tamanho é uma confirmação adicional quando a coluna estiver disponível.
    if (row._size !== undefined && row._size !== 'NULL' && row._size !== 'null' &&
      (!/^\d+$/.test(row._size) || Number(row._size) !== expected.size)) continue;
    matches.push(row);
  }
  if (matches.length === 1) {
    const [match] = matches;
    return match;
  }
  return undefined; // Nunca escolher uma linha por índice em caso de ambiguidade.
}

/** Deadline real por ciclo; broadcast ou mídia de outra tarefa nunca confirmam scan. */
export async function waitForIndexedMedia(expected: MediaIdentity, query: (remainingMs: number) => Promise<string>,
  pause: (milliseconds: number) => Promise<void>, options: {
    timeoutMs?: number; intervalMs?: number; now?: () => number;
    onAttempt?: (attempt: number, output: string, match: MediaRow | undefined) => void;
  } = {}): Promise<MediaRow | undefined> {
  const timeout = options.timeoutMs ?? 15_000, interval = options.intervalMs ?? 500, now = options.now ?? Date.now;
  const started = now();
  for (let attempt = 1; now() - started < timeout; attempt++) {
    const output = await query(Math.max(1, timeout - (now() - started)));
    const match = findIndexedMedia(output, expected);
    options.onAttempt?.(attempt, output, match);
    console.log(`[MEDIA] tentativa ${attempt}: ${match ? 'encontrado' : 'não encontrado'}`);
    if (match) return match;
    const remaining = timeout - (now() - started);
    if (remaining > 0) await pause(Math.min(interval, remaining));
  }
  return undefined;
}
