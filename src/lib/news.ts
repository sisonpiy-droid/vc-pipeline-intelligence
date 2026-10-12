import { createHash } from "node:crypto";
import { parseFeed, type FeedItem } from "@/lib/providers/feeds";
import { ageInDays, isoDay, parseDate } from "@/lib/signals/window";

/**
 * General venture-capital industry news for the News page: what is happening in the market, not specific to this founder.
 * It reads the public RSS feeds of five publications (free, no key, published to be read by software), keeps only items about
 * venture capital, and shows each as a snippet that opens to the publisher's own feed text with a link to the full story. Nothing
 * is stored. If a feed cannot be read the page says so; a failed source is never shown as "no news".
 */
export interface NewsSource { id: string; name: string; region: string; url: string }

export const NEWS_SOURCES: NewsSource[] = [
  { id: "techcrunch", name: "TechCrunch", region: "Global", url: "https://techcrunch.com/category/venture/feed/" },
  { id: "crunchbase", name: "Crunchbase News", region: "Global", url: "https://news.crunchbase.com/feed/" },
  { id: "inc42", name: "Inc42", region: "India", url: "https://inc42.com/feed/" },
  { id: "yourstory", name: "YourStory", region: "India", url: "https://yourstory.com/feed" },
  { id: "sifted", name: "Sifted", region: "Europe", url: "https://sifted.eu/feed" },
];

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceId: string;
  region: string;
  published: string; // YYYY-MM-DD
  snippet: string;
  text: string; // the publisher's own feed text, bounded
}

export interface SourceStatus { id: string; name: string; ok: boolean; items: number; note?: string }

/** Venture capital, specifically: a firm or fund, a round, an angel, a valuation. "Startup", "investor" or "backed" alone are not enough. */
const VC_RE = /\b(venture|vcs?|funding|fundrais\w*|raises?|raised|raising|seed|pre-seed|series\s+[a-e]|funds?|valuations?|unicorns?|limited partners?|lps|term sheets?|angels?|cheques?|cap table)\b/i;
/** A listing or a share-price story is about public markets, not venture capital, unless its headline is itself about VC or a round. */
const MARKETS_RE = /\b(ipo|price band|share price|stock market|sensex|nifty)\b/i;
const VC_HEADLINE_RE = /\b(venture|vcs?|funding|seed|series\s+[a-e]|raises?|raised)\b/i;
const WINDOW_DAYS = 21;
const MAX_ITEMS = 40;
const MAX_BYTES = 800_000;

const sentenceCut = (s: string, max: number) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…").trim();
};

/** Publisher feeds often end with "The post X appeared first on Y." or a read-more stub: not part of the story. */
const tidy = (s: string) => s.replace(/\s*The post .{0,200}? appeared first on .{0,120}$/i, "").replace(/\s*(Read more|Continue reading)\b.*$/i, "").replace(/\s*\[…\]\s*$|\s*\[\.\.\.\]\s*$/g, "…").trim();

export function toNews(items: FeedItem[], src: NewsSource, now: Date): NewsItem[] {
  return items.flatMap((it) => {
    const day = parseDate(it.published);
    if (!day || ageInDays(day, now) > WINDOW_DAYS || ageInDays(day, now) < -1) return []; // undated or old items are never assumed recent
    const text = tidy(it.summary);
    if (!VC_RE.test(`${it.title} ${text}`)) return [];
    if (MARKETS_RE.test(it.title) && !VC_HEADLINE_RE.test(it.title)) return [];
    return [{
      id: createHash("sha1").update(it.url).digest("hex").slice(0, 12),
      title: it.title.slice(0, 220), url: it.url, source: src.name, sourceId: src.id, region: src.region, published: day,
      snippet: text ? sentenceCut(text, 170) : "", text: sentenceCut(text, 1400),
    }];
  });
}

export function mergeNews(all: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return all
    .sort((a, b) => b.published.localeCompare(a.published) || a.title.localeCompare(b.title))
    .filter((n) => { const k = n.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); if (seen.has(n.url) || seen.has(k)) return false; seen.add(n.url); seen.add(k); return true; })
    .slice(0, MAX_ITEMS);
}

/** Offline mode (NEWS_OFFLINE=1, used only by the browser tests): canned feeds, so a test never depends on the internet. */
const offlineFetch: typeof fetch = async (input) => {
  const host = new URL(String(input)).hostname.replace(/^www\.|^news\./, "").split(".")[0]!;
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toUTCString();
  const item = (n: number, title: string, body: string) => `<item><title>${title}</title><link>https://${host}.example/story-${n}</link><pubDate>${day(n)}</pubDate><description>${body}</description></item>`;
  return new Response(`<rss><channel>${item(1, `${host}: Logistics software startup raises seed round led by an Indian VC fund`, "A seed round of 4 million dollars will fund hiring. The lead investor said it plans more early-stage cheques this year. The founders previously ran supply-chain operations.")}${item(3, `${host}: Venture funding falls in the third quarter`, "Global venture funding slowed as investors waited for valuations to reset. Late-stage rounds were hit hardest.")}${item(2, `${host}: Recipe of the week`, "Nothing about investing here.")}</channel></rss>`, { status: 200 });
};

export async function fetchNews(opts: { fetchImpl?: typeof fetch; now?: Date; sources?: NewsSource[] } = {}): Promise<{ items: NewsItem[]; status: SourceStatus[]; asOf: string }> {
  const f = opts.fetchImpl ?? (process.env.NEWS_OFFLINE === "1" ? offlineFetch : fetch);
  const now = opts.now ?? new Date();
  const results = await Promise.all((opts.sources ?? NEWS_SOURCES).map(async (src) => {
    try {
      const res = await f(src.url, { headers: { "user-agent": "VCPipelineIntelligence/1.0 (news reader)", accept: "application/rss+xml, application/atom+xml, text/xml, */*" }, signal: AbortSignal.timeout(8000), next: { revalidate: 1800 } } as RequestInit);
      if (!res.ok) return { src, items: [] as NewsItem[], status: { id: src.id, name: src.name, ok: false, items: 0, note: `HTTP ${res.status}` } };
      const items = toNews(parseFeed((await res.text()).slice(0, MAX_BYTES)), src, now);
      return { src, items, status: { id: src.id, name: src.name, ok: true, items: items.length } };
    } catch {
      return { src, items: [] as NewsItem[], status: { id: src.id, name: src.name, ok: false, items: 0, note: "could not be reached" } };
    }
  }));
  return { items: mergeNews(results.flatMap((r) => r.items)), status: results.map((r) => r.status), asOf: isoDay(now) };
}
