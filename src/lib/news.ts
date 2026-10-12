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
  { id: "techcrunch", name: "TechCrunch", region: "Global", url: "https://techcrunch.com/category/startups/feed/" },
  { id: "crunchbase", name: "Crunchbase News", region: "Global", url: "https://news.crunchbase.com/feed/" },
  { id: "entrackr", name: "Entrackr", region: "India", url: "https://entrackr.com/rss" },
  { id: "inc42", name: "Inc42", region: "India", url: "https://inc42.com/feed/" },
  { id: "yourstory", name: "YourStory", region: "India", url: "https://yourstory.com/feed" },
  { id: "et", name: "ET Startups", region: "India", url: "https://economictimes.indiatimes.com/tech/startups/rssfeeds/78570561.cms" },
  { id: "sifted", name: "Sifted", region: "Europe", url: "https://sifted.eu/feed" },
];

/** What a story is about, so the page can be filtered and the reader knows what kind of news it is before opening it. */
export type NewsTopic = "round" | "fund" | "exit" | "policy" | "people" | "market";
export const TOPIC_LABEL: Record<NewsTopic, string> = {
  round: "Funding rounds", fund: "New funds", exit: "Exits and deals", policy: "Policy and rules", people: "People and firms", market: "Market and valuations",
};

/** The same topics in plain words: what happened, and why a first-time founder might care. */
export const TOPIC_MEANS: Record<NewsTopic, string> = {
  round: "A startup raised money. It shows which kinds of company investors are backing right now.",
  fund: "An investment firm raised or launched a fund. More money for them to invest, so a good moment to approach them.",
  exit: "A company was bought or listed. Investors get money back and often fund new startups with it.",
  policy: "A rule, tax or law that affects investors or startups.",
  people: "Someone joined, left or was promoted at an investment firm. It can mean a new person to contact.",
  market: "How much money is moving and at what prices: the mood of the market.",
};

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceId: string;
  region: string;
  published: string; // YYYY-MM-DD
  topic: NewsTopic;
  /** True when the story touches the founder's own world: logistics, supply chain, freight, fleets, warehousing or B2B software. */
  matters: boolean;
  /** Higher is read first: matters to the founder, a round or a fund, VC in the headline, and how fresh it is. */
  rank: number;
  snippet: string;
  text: string; // the publisher's own feed text, bounded
}

export interface SourceStatus { id: string; name: string; ok: boolean; items: number; note?: string }

/** Venture capital, specifically: a firm or fund, a round, an angel, a valuation. "Startup", "investor" or "backed" alone are not enough. */
const VC_RE = /\b(venture|vcs?|funding|fundrais\w*|raises?|raised|raising|seed|pre-seed|series\s+[a-e]|funds?|valuations?|unicorns?|limited partners?|lps|term sheets?|angels?|cheques?|cap table)\b/i;
/** A listing or a share-price story is about public markets, not venture capital, unless its headline is itself about VC or a round. */
/** "Raises" alone is not venture capital: councils raise thresholds too. A raise needs an amount after it. */
const MONEY = String.raw`(?:rs\.?|₹|\$|us\$|usd|inr|€|£|\d)`;
const RAISE_MONEY = new RegExp(String.raw`\b(?:raises?|raised|raising|secures?|bags?)\s+(?:up to\s+|about\s+|over\s+)?${MONEY}|\braising funds\b`, "i");
/** A headline counts as venture capital when it names VC itself or a round. */
const TITLE_VC_RE = /\b(venture|vcs?|funding|seed|pre-seed|series\s+[a-e]|funds?|valuations?|unicorns?|limited partners?|term sheets?|angels?|cheques?)\b/i;
/** Newsletters, quizzes and events are not news. */
const NOISE_RE = /\b(quiz|podcast|webinar|workshop|newsletter|sponsored|advertorial)\b|&\s*more$/i;
const MARKETS_RE = /\b(ipo|price band|share price|stocks?|stock market|sensex|nifty)\b/i;
const VC_HEADLINE_RE = /\b(venture|vcs?|funding|seed|series\s+[a-e])\b/i;
const WINDOW_DAYS = 21;
const MAX_ITEMS = 60;
const MAX_PER_SOURCE = 12; // so one prolific publication cannot fill the page

/** How many different venture-capital terms a text uses ("raises" and "raised" count once each as the same idea). */
const termCount = (s: string) => new Set((s.toLowerCase().match(new RegExp(VC_RE.source, "gi")) ?? []).map((m) => (/^rais|^fundrais/.test(m) ? "raise" : /^series/.test(m) ? "series" : /^funds?$/.test(m) ? "fund" : /^(vcs?|venture)$/.test(m) ? "vc" : m))).size;

const TOPICS: [NewsTopic, RegExp][] = [
  ["fund", /\b(new fund|maiden fund|fund of funds|fund (?:close|raise|ii|iii|iv)|closes? .{0,40}\bfund|launch\w* .{0,40}\bfund|limited partners?|\blps?\b|corpus|dry powder)\b/i],
  ["round", /\b(funding round|seed|pre-seed|series\s+[a-e]|bridge round|led by)\b/i],
  ["exit", /\b(acquires?|acquisition|acquired|ipo|merger|buyout|secondary sale|exit)\b/i],
  ["round", RAISE_MONEY],
  ["policy", /\b(sebi|rbi|regulat\w*|angel tax|policy|dpiit|government|tax)\b/i],
  ["people", /\b(appoints?|joins?|hires?|promoted|new partner|steps? down|names? .{0,30}(?:partner|head))\b/i],
];
export const topicOf = (title: string): NewsTopic => TOPICS.find(([, re]) => re.test(title))?.[0] ?? "market";

const MATTERS_RE = /\b(logistics|supply[- ]chain|freight|fleets?|warehous\w*|trucking|last[- ]mile|b2b saas|enterprise saas|b2b software)\b/i;
/** In the headline, or clearly the subject of the text (two mentions): one passing word is not "your world". */
const mattersTo = (title: string, text: string) => MATTERS_RE.test(title) || (text.match(new RegExp(MATTERS_RE.source, "gi"))?.length ?? 0) >= 2;
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
    // Venture capital in the headline, or at least two different venture terms in the text: one stray "funds" is not enough.
    if (NOISE_RE.test(it.title)) return [];
    if (!TITLE_VC_RE.test(it.title) && !RAISE_MONEY.test(it.title) && termCount(text) < 2) return [];
    if (MARKETS_RE.test(it.title) && !VC_HEADLINE_RE.test(it.title)) return [];
    const topic = topicOf(it.title);
    const matters = mattersTo(it.title, text);
    const rank = (matters ? 5 : 0) + (topic === "round" || topic === "fund" ? 2 : 0) + (VC_HEADLINE_RE.test(it.title) ? 2 : 0) + Math.max(0, 3 - ageInDays(day, now));
    return [{
      id: createHash("sha1").update(it.url).digest("hex").slice(0, 12),
      title: it.title.slice(0, 220), url: it.url, source: src.name, sourceId: src.id, region: src.region, published: day, topic, matters, rank,
      snippet: text ? sentenceCut(text, 170) : "", text: sentenceCut(text, 1400),
    }];
  });
}

export function mergeNews(all: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const perSource = new Map<string, number>();
  return all
    .sort((a, b) => b.published.localeCompare(a.published) || a.title.localeCompare(b.title))
    .filter((n) => { const k = n.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); if (seen.has(n.url) || seen.has(k)) return false; seen.add(n.url); seen.add(k); return true; })
    .filter((n) => { const c = (perSource.get(n.sourceId) ?? 0) + 1; perSource.set(n.sourceId, c); return c <= MAX_PER_SOURCE; })
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
