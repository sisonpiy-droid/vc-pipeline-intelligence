import type { AiClient } from "@/lib/ai/gemini";
import type { Candidate as AiCandidate } from "@/lib/ai/analyze";
import { extractPage, type ExtractedPage } from "@/lib/providers/extract";
import { fetchOfficialFeed } from "@/lib/providers/feeds";
import { ProviderError, type PageFetcher, type SearchHit, type SearchProvider } from "@/lib/providers/types";
import { canonicalUrl } from "@/lib/normalize";
import { dedupeSignals } from "@/lib/signals/dedupe";
import { mentionsInvestor } from "@/lib/signals/match";
import { linkedinPostDate } from "@/lib/signals/linkedin";
import { checkWindow, isoDay, parseDate, windowStart } from "@/lib/signals/window";

/** Everything the pipeline needs about an investor. Deliberately excludes personal_notes / contact_history. */
export interface InvestorRow {
  id: string;
  firm_name: string;
  aliases: string[];
  entity_type: "vc_firm" | "angel" | "network" | "accelerator";
  role_title: string | null;
  partner_name: string | null;
  website_url: string | null;
  stage_preference: string | null;
  sectors: string[];
  geography: string | null;
  fit_rationale: string | null;
  investment_thesis: string | null;
  relationship_status: "not_contacted" | "contacted" | "in_conversation" | "awaiting_response" | "passed" | "committed";
  last_contact_date: string | null;
}

export interface Deps {
  /** Also search LinkedIn (public posts/articles via the search provider only; LinkedIn pages are never fetched by us). */
  linkedin?: boolean;
  /** Read the investor's own RSS/Atom feed (free, no search credits). */
  officialFeeds?: boolean;
  /** Check what the investor already backs, from its own portfolio page (monthly; free of search credits). */
  portfolio?: boolean;
  search: SearchProvider;
  pages: PageFetcher;
  ai: AiClient;
  now: () => Date;
}

export interface Rejected {
  url: string;
  canonical_url: string;
  title: string;
  reason: string;
  published_at: string | null;
  duplicate_of_url?: string;
  source_name: string | null;
}

export interface ResearchCandidate extends AiCandidate {
  canonical_url: string;
  source_name: string;
  date_source: "page" | "search_estimate" | "post_id" | "feed";
  fetched: boolean; // false → we only had the search snippet, so confidence is capped
  authority: number;
  official?: boolean;
}

export interface CoverageEntry {
  source: string;
  status: "ok" | "empty" | "error" | "skipped";
  result_count: number;
  error_category: string | null;
  note: string | null;
}

export interface ResearchResult {
  candidates: ResearchCandidate[];
  rejected: Rejected[];
  coverage: CoverageEntry[];
  searchFailed: boolean;
  searchError?: ProviderError;
  skippedKnown: number;
  /** provider calls made (search + page fetches), for the run's "sources queried" counter */
  sourcesChecked: number;
  pageFetchFailures: number;
  /** Things that really limited what we could judge (a page we needed but could not read, a secondary search that failed). Only these make coverage 'partial'. */
  incompleteSources: number;
  /** Metered search calls made (1 main + 1 if LinkedIn). Failed calls count: the provider may still bill them. */
  searchCalls: number;
}

const MAX_HITS = 8;
const MAX_LINKEDIN_HITS = 5;
const MAX_CANDIDATES = 6;
const MIN_PAGE_TEXT = 200; // shorter than this = JS-rendered shell; fall back to the search snippet

/**
 * Plain natural-language query. Tavily is a semantic search engine: an earlier version with quoted names and
 * boolean OR chains returned almost nothing, while "<name> investment announcement" returned on-topic news
 * (probed live against 4 investors). Precision does not come from the query but from the later checks:
 * the investor must be named in the page, the date must be in the window, and Gemini must verify involvement.
 */
export function buildQuery(inv: Pick<InvestorRow, "firm_name" | "aliases" | "entity_type">): string {
  const names = [inv.firm_name, ...inv.aliases].join(" OR ");
  return inv.entity_type === "angel" ? `${names} invests in startup funding round` : `${names} investment announcement`;
}

/** Static profile / directory pages describe an investor; they are not events. Rejected before any fetch or AI cost. */
const PROFILE_URL = /(crunchbase\.com\/(organization|person|funding_round)\/|pitchbook\.com\/profiles\/|tracxn\.com\/d\/|cbinsights\.com\/(investor|company)\/|linkedin\.com\/(company|in|school)\/|wikipedia\.org\/|zaubacorp\.|theorg\.com\/|owler\.com\/company\/)/i;

const LINKEDIN_HOST = /(^|\.)linkedin\.com$/i;

const hostOf = (u: string) => new URL(u).hostname.replace(/^www\./, "");

/**
 * Stages 1–4 of the pipeline for one investor: pick the query, discover, extract, validate.
 * Pure orchestration over injected providers — no database access, so it is tested with doubles.
 * Never throws for provider failures; they are reported in `coverage` / `searchFailed`.
 */
export async function research(deps: Deps, inv: InvestorRow, known: Set<string>): Promise<ResearchResult> {
  const now = deps.now();
  const rejected: Rejected[] = [];
  const coverage: CoverageEntry[] = [];
  const base = { rejected, coverage, skippedKnown: 0, sourcesChecked: 0, pageFetchFailures: 0, incompleteSources: 0, searchCalls: 0 };
  const officialHost = inv.website_url ? hostOf(inv.website_url) : null;

  let hits: SearchHit[];
  try {
    base.sourcesChecked++;
    base.searchCalls++;
    hits = await deps.search.search({ query: buildQuery(inv), startDate: windowStart(now), endDate: isoDay(now), maxResults: MAX_HITS });
    coverage.push({ source: `${deps.search.name}_search`, status: hits.length ? "ok" : "empty", result_count: hits.length, error_category: null, note: null });
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError("http_5xx", "search failed");
    coverage.push({ source: `${deps.search.name}_search`, status: "error", result_count: 0, error_category: pe.category, note: pe.message });
    return { ...base, candidates: [], searchFailed: true, searchError: pe };
  }

  if (deps.linkedin) {
    try {
      base.sourcesChecked++;
      base.searchCalls++;
      const li = await deps.search.search({
        query: buildQuery(inv), startDate: windowStart(now), endDate: isoDay(now), maxResults: MAX_LINKEDIN_HITS, includeDomains: ["linkedin.com"], allowUndated: true,
      });
      coverage.push({ source: `${deps.search.name}_linkedin_search`, status: li.length ? "ok" : "empty", result_count: li.length, error_category: null, note: null });
      hits = [...hits, ...li];
    } catch (e) {
      // A failed secondary source never fails the investor, but it does make "no signal" inconclusive.
      const pe = e instanceof ProviderError ? e : new ProviderError("http_5xx", "linkedin search failed");
      coverage.push({ source: `${deps.search.name}_linkedin_search`, status: "error", result_count: 0, error_category: pe.category, note: pe.message });
      base.incompleteSources++;
    }
  }

  const seen = new Set<string>();
  const accepted: ResearchCandidate[] = [];
  let pagesTried = 0;

  for (const hit of hits.slice(0, MAX_HITS + MAX_LINKEDIN_HITS)) {
    const canon = canonicalUrl(hit.url);
    const reject = (reason: string, extra: Partial<Rejected> = {}) =>
      rejected.push({ url: hit.url, canonical_url: canon ?? hit.url, title: hit.title || hit.url, reason, published_at: null, source_name: canon ? hostOf(canon) : null, ...extra });
    if (!canon) { reject("invalid_url"); continue; }
    if (seen.has(canon)) continue;
    seen.add(canon);
    if (PROFILE_URL.test(canon)) { reject("profile_or_directory_page"); continue; }
    if (known.has(canon)) { base.skippedKnown++; continue; } // already judged on an earlier run — no refetch, no new AI call
    if (!mentionsInvestor(`${hit.title}\n${hit.snippet}`, inv)) { reject("entity_not_mentioned"); continue; }

    // Fetch the page itself: dates and quotes must come from the source, not from a search snippet.
    // LinkedIn is the exception: its terms forbid automated fetching, so LinkedIn evidence is the search
    // provider's snippet only (confidence is capped because the page was not independently read).
    let page: ExtractedPage | null = null;
    let fetchFailed = false;
    if (!LINKEDIN_HOST.test(hostOf(canon))) {
      pagesTried++;
      base.sourcesChecked++;
      try {
        page = extractPage((await deps.pages.fetch(hit.url)).html);
      } catch {
        base.pageFetchFailures++;
        fetchFailed = true;
      }
    }
    // A failed fetch only costs coverage when the search snippet could not stand in for the page.
    const lose = (reason: string) => { if (fetchFailed && (reason === 'missing_date' || reason === 'insufficient_content')) base.incompleteSources++; };

    if (page?.date_conflict) { reject("contradictory_dates", { title: page.title || hit.title }); continue; }
    const pageDate = page?.published_at ?? null;
    const postDate = linkedinPostDate(hit.url, now); // LinkedIn posts: date decoded from the post ID
    const searchDate = parseDate(hit.published_date);
    const date = pageDate ?? postDate ?? searchDate;
    const verdict = checkWindow(date, now);
    if (!verdict.ok) { lose(verdict.reason); reject(verdict.reason, { published_at: date, title: page?.title || hit.title }); continue; }

    const usePage = !!page && page.text.length >= MIN_PAGE_TEXT;
    const text = usePage ? page!.text : hit.snippet;
    const title = (page?.title || hit.title || hit.url).trim();
    if (!mentionsInvestor(`${title}\n${text}`, inv)) { reject("entity_not_mentioned", { published_at: date, title }); continue; }
    if (text.length < 40) { lose("insufficient_content"); reject("insufficient_content", { published_at: date, title }); continue; }

    accepted.push({
      index: -1, // assigned after dedupe
      url: hit.url,
      canonical_url: canon,
      title,
      text,
      published_at: date!,
      source_name: hostOf(canon),
      date_source: pageDate ? "page" : postDate ? "post_id" : "search_estimate",
      fetched: usePage,
      authority: officialHost && hostOf(canon).endsWith(officialHost) ? 5 : 1,
    });
  }

  // Official feed: the investor's own news, dated by the feed. Costs no search credits.
  if (deps.officialFeeds && inv.website_url) {
    const feed = await fetchOfficialFeed(deps.pages, inv.website_url, windowStart(now), isoDay(now));
    if (feed.status === "found") {
      base.sourcesChecked++;
      coverage.push({ source: "official_feed", status: feed.inWindow.length ? "ok" : "empty", result_count: feed.inWindow.length, error_category: null, note: feed.inWindow.length ? null : "feed found; no post in the last 30 days" });
      for (const it of feed.inWindow) {
        const canon = canonicalUrl(it.url);
        if (!canon || seen.has(canon)) continue;
        seen.add(canon);
        if (known.has(canon)) { base.skippedKnown++; continue; }
        const date = parseDate(it.published)!;
        let page: ExtractedPage | null = null;
        try {
          base.sourcesChecked++;
          page = extractPage((await deps.pages.fetch(it.url)).html);
        } catch {
          base.pageFetchFailures++;
        }
        if (page?.date_conflict || (page?.published_at && Math.abs(Date.parse(page.published_at) - Date.parse(date)) > 3 * 86_400_000)) {
          rejected.push({ url: it.url, canonical_url: canon, title: it.title, reason: "contradictory_dates", published_at: date, source_name: hostOf(canon) });
          continue;
        }
        const body = page && page.text.length >= MIN_PAGE_TEXT ? page.text : it.summary;
        if (body.length < 40) {
          rejected.push({ url: it.url, canonical_url: canon, title: it.title, reason: "insufficient_content", published_at: date, source_name: hostOf(canon) });
          continue;
        }
        accepted.push({ index: -1, url: it.url, canonical_url: canon, title: it.title, text: body, published_at: date, source_name: hostOf(canon), date_source: "feed", fetched: body === page?.text, authority: 5, official: true });
      }
    } else if (feed.status === "none") {
      coverage.push({ source: "official_feed", status: "skipped", result_count: 0, error_category: null, note: feed.note });
    } else {
      coverage.push({ source: "official_feed", status: "error", result_count: 0, error_category: feed.error.category, note: feed.error.message });
    }
  }

  const { kept, duplicates } = dedupeSignals(accepted.map((c) => ({ ...c, headline: c.title })));
  for (const d of duplicates)
    rejected.push({ url: d.item.url, canonical_url: d.item.canonical_url, title: d.item.title, reason: "duplicate_event", published_at: d.item.published_at, duplicate_of_url: d.of.canonical_url, source_name: d.item.source_name });
  const candidates = kept.slice(0, MAX_CANDIDATES).map((c, i) => ({ ...c, index: i }));
  for (const c of kept.slice(MAX_CANDIDATES))
    rejected.push({ url: c.url, canonical_url: c.canonical_url, title: c.title, reason: "over_candidate_cap", published_at: c.published_at, source_name: c.source_name });

  if (pagesTried === 0) {
    // Overwrite any stale page_fetch error from an earlier run so coverage reflects this run only.
    coverage.push({ source: "page_fetch", status: "skipped", result_count: 0, error_category: null, note: "no new pages needed fetching" });
  } else {
    const failed = base.pageFetchFailures;
    coverage.push({
      source: "page_fetch",
      status: failed === pagesTried ? "error" : "ok",
      result_count: pagesTried - failed,
      error_category: failed === pagesTried ? "unfetchable" : null,
      note: failed ? `${failed} of ${pagesTried} pages could not be fetched (${base.incompleteSources} could not be judged without the page; the rest were judged from the search snippet)` : null,
    });
  }
  return { ...base, candidates, searchFailed: false, skippedKnown: base.skippedKnown };
}
