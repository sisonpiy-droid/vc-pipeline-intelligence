import type { InvestorState } from "./read";

export type Tone = "good" | "warn" | "bad" | "info" | "neutral";

export const ACTION_LABEL: Record<string, string> = {
  reach_out_now: "Reach out now",
  prepare_targeted_outreach: "Prepare targeted outreach",
  wait_for_response: "Wait for response",
  research_further: "Research further",
  no_action: "No action now",
};
export const ACTION_TONE: Record<string, Tone> = {
  reach_out_now: "good",
  prepare_targeted_outreach: "info",
  wait_for_response: "neutral",
  research_further: "warn",
  no_action: "neutral",
};

export const TYPE_LABEL: Record<string, string> = {
  portfolio_investment: "Portfolio investment",
  article: "Article",
  interview_podcast: "Interview / podcast",
  public_statement: "Public statement",
  event_appearance: "Event appearance",
  fund_thesis_announcement: "Fund / thesis announcement",
  other: "Other",
};

export const REL_LABEL: Record<string, string> = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  in_conversation: "In conversation",
  awaiting_response: "Awaiting response",
  passed: "Passed",
  committed: "Committed",
};

export const ENTITY_LABEL: Record<string, string> = { vc_firm: "VC firm", angel: "Angel", network: "Network", accelerator: "Accelerator" };

export const CONFIDENCE_TONE: Record<string, Tone> = { high: "good", medium: "warn", low: "bad" };

export const STATE_META: Record<InvestorState, { label: string; tone: Tone; help: string }> = {
  active: { label: "Active signal", tone: "good", help: "A verified, relevant signal in the last 30 days." },
  quiet_complete: { label: "Quiet", tone: "neutral", help: "Every source answered; nothing relevant in the last 30 days." },
  stale: { label: "Quiet (older signals)", tone: "neutral", help: "Nothing in the last 30 days; relevant signals exist from before the window." },
  quiet_partial: { label: "Needs review", tone: "warn", help: "Nothing found, but some sources failed — absence of a signal is not conclusive." },
  failed: { label: "Failed refresh", tone: "bad", help: "The latest refresh failed, so this investor's recent activity is unknown." },
  not_checked: { label: "Not checked yet", tone: "warn", help: "No refresh has completed for this investor." },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-10-08 → "8 Oct 2026" (no time-zone arithmetic: dates are calendar days). */
export function fmtDate(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "—";
}

/** India Standard Time is a fixed UTC+05:30 (India has no daylight saving), so no time-zone database is needed. */
const IST_OFFSET_MS = 330 * 60_000;

/** Timestamps are stored in UTC and shown in Indian time: "11 Oct 2026, 11:08 IST". */
export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const d = new Date(t + IST_OFFSET_MS); // read the shifted instant with the UTC getters
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} IST`;
}

/** Just the date part of fmtDateTime ("11 Oct 2026"), in Indian time. */
export const fmtDateIST = (iso: string | Date | null | undefined): string => fmtDateTime(iso).split(",")[0]!;

export function ago(iso: string | Date | null | undefined, now = new Date()): string {
  if (!iso) return "never";
  const secs = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 90) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

/** Only http(s) URLs become links. Evidence URLs are validated at write time; this is the render-time backstop. */
export function safeHref(url: string | null | undefined): string | null {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Platforms worth naming on an evidence card (where the signal appeared). */
export function platformOf(host: string | null | undefined): string | null {
  const h = (host ?? "").replace(/^www\./, "").toLowerCase();
  if (h.endsWith("linkedin.com")) return "LinkedIn";
  if (h.endsWith("youtube.com") || h === "youtu.be") return "YouTube";
  if (h.endsWith("instagram.com")) return "Instagram";
  if (h.endsWith("x.com") || h.endsWith("twitter.com")) return "X";
  if (h.endsWith("facebook.com")) return "Facebook";
  return null;
}

const PRESS = /(^|\.)(techcrunch\.com|economictimes\.indiatimes\.com|livemint\.com|inc42\.com|entrackr\.com|yourstory\.com|business-standard\.com|moneycontrol\.com|thehindu(businessline)?\.com|reuters\.com|bloomberg\.com|vccircle\.com|forbesindia\.com|financialexpress\.com|ndtv\.com|hindustantimes\.com|theprint\.in|dealstreetasia\.com|business-today\.in|businesstoday\.in|ft\.com|wsj\.com)$/i;

/** How much to trust where a signal appeared: the investor's own site, recognised press, social posts, or other. */
export function sourceTier(host: string | null | undefined, investorWebsite?: string | null): "official" | "press" | "social" | "other" {
  const h = (host ?? "").replace(/^www\./, "").toLowerCase();
  if (!h) return "other";
  const own = investorWebsite ? hostOf(investorWebsite).replace(/^www\./, "").toLowerCase() : null;
  if (own && (h === own || h.endsWith(`.${own}`))) return "official";
  if (platformOf(h)) return "social";
  return PRESS.test(h) ? "press" : "other";
}

/** No LinkedIn URL is stored for any investor and none is guessed: this opens a LinkedIn search for them. */
export const linkedinSearchUrl = (name: string, entityType: string) =>
  `https://www.linkedin.com/search/results/${entityType === "angel" ? "people" : "companies"}/?keywords=${encodeURIComponent(name)}`;

export const webSearchUrl = (name: string) => `https://www.google.com/search?q=${encodeURIComponent(name)}`;

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Turns a stored error code into something a founder can act on. */
export function explainError(code: string | null | undefined): { title: string; action: string } {
  const c = code ?? "";
  const table: [RegExp, { title: string; action: string }][] = [
    [/search_failed:rate_limited/, { title: "Search provider rate-limited the request", action: "Retried 3 times. It will be retried on the next run; if it recurs, lower the run's concurrency or upgrade the search plan." }],
    [/search_failed:quota_exhausted/, { title: "Search credits exhausted", action: "Top up or wait for the monthly allowance to reset, then re-run. Investors keep their previous scores meanwhile." }],
    [/search_failed:no_credentials|ai_failed:no_credentials/, { title: "An API key is missing or was rejected", action: "Check TAVILY_API_KEY / GEMINI_API_KEY in the Vercel environment variables, then re-run." }],
    [/search_failed:timeout|search_failed:http_5xx/, { title: "Search provider unavailable", action: "Retried 3 times. Usually transient — the next run will retry." }],
    [/search_failed:malformed/, { title: "Search provider returned an unexpected response", action: "Likely a provider API change; check the provider status page." }],
    [/ai_failed:rate_limited/, { title: "Gemini rate limit or quota reached", action: "Evidence was kept as 'needs review'. Re-run later or check the Gemini API quota." }],
    [/ai_failed:invalid_output/, { title: "Gemini returned output that failed validation", action: "Nothing was written; the evidence is kept as 'needs review'. The next run retries it." }],
    [/ai_failed/, { title: "Gemini analysis was unavailable", action: "Evidence was kept as 'needs review' and no score was changed. The next run retries it." }],
    [/internal:/, { title: "Unexpected internal error", action: "The investor was rolled back cleanly (no partial writes). Check the audit log and re-run." }],
  ];
  return table.find(([re]) => re.test(c))?.[1] ?? { title: c || "Unknown error", action: "See the audit log for details." };
}

export const SECTOR_LABEL: Record<string, { label: string; tone: Tone; help: string }> = {
  logistics: { label: "Logistics fit", tone: "good", help: "The signal is about logistics, supply chain, fleets, warehousing or commerce infrastructure." },
  b2b_software: { label: "B2B software", tone: "info", help: "Enterprise software or B2B AI, but not logistics itself." },
  seed_generalist: { label: "Seed activity", tone: "info", help: "General seed or early-stage activity (a fund, programme, cheque size or advice), not tied to one sector." },
  adjacent: { label: "Adjacent sector", tone: "warn", help: "A technology deal in another vertical (fintech, health, consumer, semiconductors...). Relevance is capped." },
  unrelated: { label: "Off-topic", tone: "neutral", help: "Not relevant to the founder's market." },
};

export const TIER_LABEL: Record<string, { label: string; tone: Tone; help: string }> = {
  official: { label: "Official source", tone: "good", help: "Published on the investor's own website." },
  press: { label: "Press", tone: "neutral", help: "A recognised news publication." },
  social: { label: "Social post", tone: "warn", help: "A social-media post: counts less as evidence and cannot alone justify a cold approach." },
  other: { label: "Other source", tone: "neutral", help: "A website that is neither the investor's own nor a recognised publication." },
};
