import { canonicalArticleURL } from "./feedDomain.js";
export type TextFetcher = (
  url: string,
  maxBytes?: number,
) => Promise<{ text: string; url: string }>;
/** Bounded, timed HTTP reads; parse direct HTML/XML without browser interaction. */
export const fetchText: TextFetcher = async (
  input,
  maxBytes = 5 * 1024 * 1024,
) => {
  let url = canonicalArticleURL(input);
  const signal = AbortSignal.timeout(30_000);
  for (let i = 0; i <= 5; i++) {
    const response = await fetch(url, {
      signal,
      redirect: "manual",
      headers: {
        "User-Agent": "PlantaoRioStoryIngestion/1.0",
        Accept: "text/html, application/rss+xml, application/xml, text/xml",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next || i === 5) throw Error("Redirect inválido/excessivo.");
      url = canonicalArticleURL(next, url);
      continue;
    }
    if (!response.ok || !response.body) throw Error(`HTTP ${response.status}`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw Error("HTML/XML excede limite.");
      chunks.push(chunk);
    }
    return { text: Buffer.concat(chunks).toString("utf8"), url };
  }
  throw Error("Resposta HTTP ausente.");
};
