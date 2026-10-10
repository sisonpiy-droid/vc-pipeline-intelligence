import type { AiClient } from "@/lib/ai/gemini";
import type { Candidate as AiCandidate } from "@/lib/ai/analyze";
import { extractPage, type ExtractedPage } from "@/lib/providers/extract";
import { ProviderError, type PageFetcher, type SearchHit, type SearchProvider } from "@/lib/providers/types";
import { canonicalUrl } from "@/lib/normalize";
import { dedupeSignals } from "@/lib/signals/dedupe";
import { mentionsInvestor } from "@/lib/signals/match";
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
  date_source: "page" | "search_estimate";
  fetched: boolean; // false → we only had the search snippet, so confidence is capped
  authority: number;
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
}

const MAX_HITS = 8;
const MAX_CANDIDATES = 6;
const MIN_PAGE_TEXT = 200; // shorter than this = JS-rendered shell; fall back to the search snippet

const q = (s: string) => `"${s.replace(/"/g, "")}"`;

export function buildQuery(inv: Pick<InvestorRow, "firm_name" | "aliases" | "entity_type">): string {
  const names = [inv.firm_name, ...inv.aliases].map(q).join(" OR ");
  const topics =
    inv.entity_type === "angel"
      ? "invests OR investment OR angel OR podcast OR interview OR logistics OR \"supply chain\""
      : "logistics OR \"supply chain\" OR investment OR portfolio OR podcast OR interview OR thesis";
  return `(${names}) (${topics})`;
}

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
  const base = { rejected, coverage, skippedKnown: 0, sourcesChecked: 0, pageFetchFailures: 0 };
  const officialHost = inv.website_url ? hostOf(inv.website_url) : null;

  let hits: SearchHit[];
  try {
    base.sourcesChecked++;
    hits = await deps.search.search({ query: buildQuery(inv), startDate: windowStart(now), endDate: isoDay(now), maxResults: MAX_HITS });
    coverage.push({ source: `${deps.search.name}_search`, status: hits.length ? "ok" : "empty", result_count: hits.length, error_category: null, note: null });
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError("http_5xx", "search failed");
    coverage.push({ source: `${deps.search.name}_search`, status: "error", result_count: 0, error_category: pe.category, note: pe.message });
    return { ...base, candidates: [], searchFailed: true, searchError: pe };
  }

  const seen = new Set<string>();
  const accepted: ResearchCandidate[] = [];
  let pagesTried = 0;

  for (const hit of hits.slice(0, MAX_HITS)) {
    const canon = canonicalUrl(hit.url);
    const reject = (reason: string, extra: Partial<Rejected> = {}) =>
      rejected.push({ url: hit.url, canonical_url: canon ?? hit.url, title: hit.title || hit.url, reason, published_at: null, source_name: canon ? hostOf(canon) : null, ...extra });
    if (!canon) { reject("invalid_url"); continue; }
    if (seen.has(canon)) continue;
    seen.add(canon);
    if (known.has(canon)) { base.skippedKnown++; continue; } // already judged on an earlier run — no refetch, no new AI call
    if (!mentionsInvestor(`${hit.title}\n${hit.snippet}`, inv)) { reject("entity_not_mentioned"); continue; }

    // Fetch the page itself: dates and quotes must come from the source, not from a search snippet.
    let page: ExtractedPage | null = null;
    pagesTried++;
    base.sourcesChecked++;
    try {
      page = extractPage((await deps.pages.fetch(hit.url)).html);
    } catch {
      base.pageFetchFailures++;
    }

    if (page?.date_conflict) { reject("contradictory_dates", { title: page.title || hit.title }); continue; }
    const pageDate = page?.published_at ?? null;
    const searchDate = parseDate(hit.published_date);
    const date = pageDate ?? searchDate;
    const verdict = checkWindow(date, now);
    if (!verdict.ok) { reject(verdict.reason, { published_at: date, title: page?.title || hit.title }); continue; }

    const usePage = !!page && page.text.length >= MIN_PAGE_TEXT;
    const text = usePage ? page!.text : hit.snippet;
    const title = (page?.title || hit.title || hit.url).trim();
    if (!mentionsInvestor(`${title}\n${text}`, inv)) { reject("entity_not_mentioned", { published_at: date, title }); continue; }
    if (text.length < 40) { reject("insufficient_content", { published_at: date, title }); continue; }

    accepted.push({
      index: -1, // assigned after dedupe
      url: hit.url,
      canonical_url: canon,
      title,
      text,
      published_at: date!,
      source_name: hostOf(canon),
      date_source: pageDate ? "page" : "search_estimate",
      fetched: usePage,
      authority: officialHost && hostOf(canon).endsWith(officialHost) ? 5 : 1,
    });
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
      note: failed ? `${failed} of ${pagesTried} pages could not be fetched; those relied on the search snippet or were dropped` : null,
    });
  }
  return { ...base, candidates, searchFailed: false, skippedKnown: base.skippedKnown };
}
