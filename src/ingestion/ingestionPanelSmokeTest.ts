import "dotenv/config";
const port = Number(process.env.ADMIN_PORT ?? 4310);
const article_url =
  process.env.ARTICLE_URL ??
  "https://plantaorio.com.br/valenca-amplia-atendimento-pelo-sus-com-aditivo-de-35-milhoes-mrdd68z";
try {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("ADMIN_PORT inválida.");
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(base + "/api/feed/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Request": "local" },
    body: JSON.stringify({ article_url }),
    signal: AbortSignal.timeout(120_000),
  });
  const entry = await response.json();
  if (!response.ok || !entry.job_id)
    throw Error(entry.last_error ?? entry.error ?? entry.status);
  const listing = await fetch(base + "/api/operations/queue").then((r) =>
    r.json(),
  );
  const job = listing.jobs.find(
    (j: { job_id: string }) => j.job_id === entry.job_id,
  );
  if (!job || listing.engineConnected !== false)
    throw Error("Job não confirmado na fila do painel.");
  console.log("[ARTICLE]", job.story_url);
  console.log(
    "[QUEUE] job:",
    job.job_id,
    "status:",
    job.status,
    "attempts:",
    job.attempts,
  );
  console.log("[OK] job visível na Fila do painel");
  console.log("[SAFE] Instagram não acessado; publicação não executada.");
} catch (error) {
  console.error("[FAIL] Inicie npm run admin em outro terminal.", error);
  process.exitCode = 1;
}
