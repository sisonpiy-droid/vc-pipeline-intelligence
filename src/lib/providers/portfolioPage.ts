import { decodeEntities, extractPage } from "./extract";
import { ProviderError, type PageFetcher } from "./types";

/**
 * Finds an investor's own portfolio page and returns its readable text. Plain HTTP through the shared SSRF-guarded,
 * robots-aware fetcher; no search credits. The investor's own site is the best source for "which companies do they
 * back", and it is public information they publish for exactly this purpose.
 */
export const PORTFOLIO_PATHS = ["/portfolio", "/companies", "/our-portfolio", "/investments", "/portfolio-companies"];
const MAX_ATTEMPTS = 5;
export const MIN_PORTFOLIO_TEXT = 400; // shorter = a logo grid with no text, or a JavaScript shell

const LINK_WORDS = /portfolio|our[- ]?companies|companies|investments|backed|startups/i;

const EXACT_PATH = /^\/(our-)?(portfolio|companies|investments|startups)(-companies)?\/?$/i;

/**
 * Same-site links whose address or visible text says "portfolio", best first: an address that IS the portfolio index
 * (/portfolio, /companies) beats a short link labelled "Portfolio", which beats anything else (a single company page or a
 * blog post that merely mentions investments), which is dropped. Never follows another domain.
 */
export function discoverPortfolioUrls(homeHtml: string, base: string): string[] {
  const host = new URL(base).hostname.replace(/^www\./, "");
  const found = new Map<string, number>();
  for (const m of homeHtml.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decodeEntities(m[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const labelled = label.length < 40 && LINK_WORDS.test(label);
    if (!LINK_WORDS.test(m[1]!) && !labelled) continue;
    try {
      const u = new URL(decodeEntities(m[1]!), base);
      if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) continue;
      u.hash = "";
      const depth = u.pathname.split("/").filter(Boolean).length;
      const rank = EXACT_PATH.test(u.pathname) ? 0 : labelled && depth <= 2 ? 1 : 3;
      const key = u.toString();
      found.set(key, Math.min(found.get(key) ?? 9, rank));
    } catch {
      /* ignore malformed href */
    }
  }
  return [...found.entries()].filter(([, r]) => r <= 1).sort((a, b) => a[1] - b[1] || a[0].length - b[0].length).map(([u]) => u); // rank 3 (team pages, posts, single companies) is never worth a fetch
}

export type PortfolioPage =
  | { status: "found"; url: string; title: string; text: string }
  | { status: "none"; note: string }
  | { status: "error"; error: ProviderError };

export async function fetchPortfolioPage(pages: PageFetcher, website: string): Promise<PortfolioPage> {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return { status: "none", note: "no valid website on record" };
  }
  let discovered: string[] = [];
  try {
    discovered = discoverPortfolioUrls((await pages.fetch(base.toString())).html, base.toString());
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e; // homepage unreachable: still try the conventional paths
  }
  // The links the homepage itself calls "portfolio" first, then the conventional paths, then any other candidate.
  const candidates = [...discovered.slice(0, 2), ...PORTFOLIO_PATHS.map((p) => new URL(p, base.origin).toString()), ...discovered.slice(2)];

  const tried = [...new Set(candidates)].slice(0, MAX_ATTEMPTS);
  let thin = 0;
  let lastError: ProviderError | null = null;
  for (const url of tried) {
    try {
      const page = extractPage((await pages.fetch(url)).html);
      // A link labelled "Portfolio" that lands on something else (a team page, a post) is not a portfolio index.
      const isIndex = EXACT_PATH.test(new URL(url).pathname) || LINK_WORDS.test(page.title);
      if (page.text.length >= MIN_PORTFOLIO_TEXT && isIndex) return { status: "found", url, title: page.title, text: page.text };
      thin++;
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      if (e.category !== "http_4xx") lastError = e;
    }
  }
  if (thin > 0) return { status: "none", note: "a portfolio page exists but has almost no readable text (a logo grid or a JavaScript-rendered page)" };
  return lastError && lastError.category !== "blocked"
    ? { status: "error", error: lastError }
    : { status: "none", note: `no portfolio page found (${tried.length} location${tried.length === 1 ? "" : "s"} tried)` };
}
