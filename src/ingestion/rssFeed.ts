import { XMLParser, XMLValidator } from "fast-xml-parser";
import { canonicalArticleURL } from "./feedDomain.js";
export interface FeedItem {
  article_url: string | null;
  feed_guid: string | null;
}
/** Keep editorial data out of the queue; only link/guid are needed. */
export function parseFeed(xml: string, feedURL: string): FeedItem[] {
  if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw Error("RSS/XML inválido.");
  const doc = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
    parseTagValue: false,
  }).parse(xml);
  const rss = doc?.rss?.channel;
  const atom = doc?.feed;
  if (!rss && !atom) throw Error("Feed RSS/Atom não reconhecido.");
  const value = rss ? rss.item : atom.entry;
  const entries = value ? (Array.isArray(value) ? value : [value]) : [];
  if (entries.length > 1000)
    throw Error("Feed excede 1000 itens; consulta cancelada.");
  const scalar = (v: any): string | null =>
    typeof v === "string"
      ? v
      : typeof v?.["#text"] === "string"
        ? v["#text"]
        : null;
  return entries
    .map((entry: any) => {
      const guid = scalar(entry.guid ?? entry.id);
      const links = Array.isArray(entry.link) ? entry.link : [entry.link];
      const atomLink = links.find(
        (l: any) => l && (!l["@_rel"] || l["@_rel"] === "alternate"),
      );
      let raw = rss ? scalar(entry.link) : atomLink?.["@_href"];
      if (
        !raw &&
        entry.guid?.["@_isPermaLink"] !== "false" &&
        guid &&
        /^https?:\/\//.test(guid)
      )
        raw = guid;
      let article_url = null;
      try {
        if (raw) article_url = canonicalArticleURL(raw, feedURL);
      } catch {
        /* retain guid for diagnosis */
      }
      return { article_url, feed_guid: guid };
    })
    .filter((item: FeedItem) => item.article_url || item.feed_guid);
}
