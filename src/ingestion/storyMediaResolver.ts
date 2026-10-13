import { load } from "cheerio";
import { canonicalArticleURL, articleIdentity } from "./feedDomain.js";
import { fetchText, type TextFetcher } from "./httpText.js";
export class ArticleResolveError extends Error {
  constructor(
    public code: "ARTICLE_RESOLVE_FAILED" | "MEDIA_NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}
export interface ResolvedArticle {
  article_url: string;
  media_url: string;
  media_type: "IMAGE" | "VIDEO";
}
export class StoryMediaResolver {
  constructor(private fetcher: TextFetcher = fetchText) {}
  async resolve(article_url: string): Promise<ResolvedArticle> {
    try {
      const requested = canonicalArticleURL(article_url);
      const page = await this.fetcher(requested);
      const finalURL = canonicalArticleURL(page.url);
      const $ = load(page.text);
      const canonical = $('link[rel="canonical"]').attr("href");
      const actual = canonical
        ? canonicalArticleURL(canonical, finalURL)
        : finalURL;
      if (new URL(actual).host !== new URL(finalURL).host)
        throw new ArticleResolveError(
          "ARTICLE_RESOLVE_FAILED",
          "Canonical pertence a outro site.",
        );
      const candidates = new Map<string, ResolvedArticle>();
      $("[data-story]").each((_index, node) => {
        const media = $(node).attr("data-story")?.trim();
        const link = $(node).attr("data-link")?.trim();
        if (!media || !link) return;
        try {
          if (articleIdentity(link, finalURL) !== articleIdentity(actual))
            return;
          const mediaURL = canonicalArticleURL(media, finalURL);
          candidates.set(mediaURL, {
            article_url: actual,
            media_url: mediaURL,
            media_type: /\.mp4$/i.test(new URL(mediaURL).pathname)
              ? "VIDEO"
              : "IMAGE",
          });
        } catch {
          /* Invalid/mismatched share data never becomes a job. */
        }
      });
      if (candidates.size !== 1)
        throw new ArticleResolveError(
          "MEDIA_NOT_FOUND",
          candidates.size
            ? "Mais de uma mídia Story inequívoca; revisão necessária."
            : "data-story/data-link da matéria não encontrados ou não correspondem.",
        );
      const candidate = candidates.values().next().value;
      if (!candidate)
        throw new ArticleResolveError("MEDIA_NOT_FOUND", "Mídia ausente.");
      return candidate;
    } catch (error) {
      if (error instanceof ArticleResolveError) throw error;
      throw new ArticleResolveError("ARTICLE_RESOLVE_FAILED", String(error));
    }
  }
}
