import { decodeEntities } from "./extract";
import { ProviderError, type PageFetcher } from "./types";
import { parseDate } from "@/lib/signals/window";

/**
 * Official-site discovery: an investor's own blog/news RSS or Atom feed, over plain HTTP. Free (no search credits),
 * dated by the feed itself, and the highest-authority evidence there is — the investor announcing its own news.
 * Feeds are published precisely so they can be read by software, and the fetcher is the same SSRF-guarded,
 * robots.txt-aware one used everywhere else.
 */
export interface FeedItem {
  url: string;
  title: string;
  summary: string; // plain text from the item's description / content
  published: string | null; // raw date string from the feed
}

export const FEED_PATHS = ["/feed", "/feed.xml", "/rss", "/rss.xml", "/atom.xml", "/blog/feed", "/blog/rss.xml", "/news/feed"];
const MAX_ATTEMPTS = 4; // homepage-advertised feeds first, then common paths
const MAX_ITEMS = 5;

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  if (!m) return null;
  const v = m[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  return v;
};
const text = (s: string | null) => decodeEntities(decodeEntities((s ?? "").replace(/<[^>]+>/g, " "))).replace(/\s+/g, " ").trim();

/** RSS 2.0 `<item>` and Atom `<entry>`. Garbage in → empty list out; never throws. */
export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, 30);
  for (const [, , body] of blocks) {
    const title = text(tag(body!, "title"));
    // RSS: <link>url</link>; Atom: <link href="url" rel="alternate"/>
    let url = text(tag(body!, "link"));
    if (!url) {
      const links = [...body!.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]!);
      const alt = links.find((a) => /rel\s*=\s*["']alternate["']/i.test(a)) ?? links.find((a) => !/rel\s*=/i.test(a)) ?? links[0];
      url = alt ? (/href\s*=\s*["']([^"']+)["']/i.exec(alt)?.[1] ?? "") : "";
    }
    const published = text(tag(body!, "pubDate") ?? tag(body!, "published") ?? tag(body!, "dc:date") ?? tag(body!, "updated")) || null;
    const summary = text(tag(body!, "content:encoded") ?? tag(body!, "description") ?? tag(body!, "summary") ?? tag(body!, "content"));
    if (title && /^https?:\/\//i.test(url)) out.push({ url, title, summary, published });
  }
  return out;
}

/** Feed URLs a homepage advertises via <link rel="alternate" type="application/rss+xml|atom+xml">. */
export function discoverFeedUrls(homeHtml: string, base: string): string[] {
  const urls: string[] = [];
  for (const m of homeHtml.matchAll(/<link\b[^>]*>/gi)) {
    const tagText = m[0];
    if (!/rel\s*=\s*["']alternate["']/i.test(tagText) || !/type\s*=\s*["']application\/(rss|atom)\+xml["']/i.test(tagText)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tagText)?.[1];
    if (!href) continue;
    try {
      urls.push(new URL(decodeEntities(href), base).toString());
    } catch {
      /* ignore malformed href */
    }
  }
  return [...new Set(urls)];
}

export type FeedResult =
  | { status: "found"; feedUrl: string; items: FeedItem[]; inWindow: FeedItem[]; fetchFailures: number }
  | { status: "none"; note: string }
  | { status: "error"; error: ProviderError };

/** Finds the investor's feed and returns up to 5 of its newest items that fall inside [windowStart, windowEnd]. */
export async function fetchOfficialFeed(pages: PageFetcher, website: string, windowStart: string, windowEnd: string): Promise<FeedResult> {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return { status: "none", note: "no valid website on record" };
  }

  const candidates: string[] = [];
  try {
    candidates.push(...discoverFeedUrls((await pages.fetch(base.toString())).html, base.toString()));
  } catch (e) {
    // The site itself did not answer. Still try the conventional paths below (it may be only the homepage that is blocked).
    if (!(e instanceof ProviderError)) throw e;
  }
  for (const p of FEED_PATHS) candidates.push(new URL(p, base.origin).toString());

  let lastError: ProviderError | null = null;
  const tried = [...new Set(candidates)].slice(0, MAX_ATTEMPTS);
  for (const url of tried) {
    try {
      const items = parseFeed((await pages.fetch(url)).html);
      if (items.length === 0) continue;
      const inWindow = items
        .map((it) => ({ it, d: parseDate(it.published) }))
        .filter((x): x is { it: FeedItem; d: string } => !!x.d && x.d >= windowStart && x.d <= windowEnd) // undated items are never assumed recent
        .sort((a, b) => b.d.localeCompare(a.d))
        .slice(0, MAX_ITEMS)
        .map((x) => x.it);
      return { status: "found", feedUrl: url, items, inWindow, fetchFailures: 0 };
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      if (e.category !== "http_4xx") lastError = e; // a 404 just means "no feed here"; anything else is worth reporting
    }
  }
  return lastError && lastError.category !== "blocked"
    ? { status: "error", error: lastError }
    : { status: "none", note: `no RSS/Atom feed found (${tried.length} location${tried.length === 1 ? "" : "s"} tried)` };
}
