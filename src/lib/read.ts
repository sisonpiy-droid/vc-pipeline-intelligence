import type { Db } from "@/lib/db";
import { sourceTier } from "@/lib/format";
import { ACTION_THRESHOLDS, DEFAULT_CONFIG, RELEVANCE_MIN, type SectorMatch, type SourceTier } from "@/lib/scoring/score";
import { ageInDays, windowStart } from "@/lib/signals/window";

/**
 * Read model for the dashboard. All "state" is derived here from stored facts, at read time, so a
 * signal that ages out of the 30-day window changes the dashboard without needing a refresh.
 */
export type InvestorState = "active" | "failed" | "quiet_partial" | "stale" | "quiet_complete" | "not_checked";

export interface StateInputs {
  relevant_30d: number;
  has_item: boolean; // has this investor ever finished (or failed) a refresh?
  latest_failed: boolean; // did the most recent attempt fail?
  partial: boolean; // did the most recent successful attempt have incomplete source coverage?
  last_relevant: string | null; // most recent relevant verified signal, any age
}

/**
 * Precedence matters: a failed or partial retrieval must never be read as "quiet".
 *   active          ≥1 verified, relevant signal in the window
 *   failed          the latest refresh for this investor failed — we do not know their activity
 *   not_checked     never refreshed
 *   quiet_partial   refreshed, nothing found, but some sources failed — absence is not conclusive
 *   stale           refreshed, nothing in the window, but older relevant signals exist
 *   quiet_complete  refreshed, every source answered, nothing relevant in the window
 */
export function deriveState(i: StateInputs, today: string): InvestorState {
  if (i.relevant_30d > 0) return "active";
  if (i.latest_failed) return "failed";
  if (!i.has_item) return "not_checked";
  if (i.partial) return "quiet_partial";
  if (i.last_relevant && ageInDays(i.last_relevant, new Date(`${today}T00:00:00Z`)) > 30) return "stale";
  return "quiet_complete";
}

/**
 * SQL for a signal's relevance after the topic cap (see scoring/score.ts). One definition, so the dashboard counts, the
 * feed and the score always agree on which signals are "relevant".
 */
export const effRel = (a: string) =>
  `least(${a}.relevance_score, case ${a}.sector_match ${Object.entries(DEFAULT_CONFIG.sectorCap).map(([k, v]) => `when '${k}' then ${v}`).join(" ")} else 100 end)`;

/**
 * Which investors a read covers: `false` = real ones only (the default), `true` = synthetic demo accounts only, "all" = both.
 * The main site lists everything (demo accounts are labelled on every row and card); anything that makes a claim about the real
 * pipeline (counts, the weekly brief, run history, the "Start here" shortlist) reads real investors only.
 */
export type Scope = boolean | "all";
const scopeKey = (s: Scope) => (s === "all" ? "all" : s ? "demo" : "real");
const inScope = (p: string, alias = "i") => `(${p}::text = 'all' or ${alias}.is_demo = (${p}::text = 'demo'))`;

export interface LeadSignal {
  headline: string;
  /** The page's own title when `headline` was rewritten by the review pass; null when the title is shown as is. */
  raw_headline: string | null;
  sector_match: SectorMatch | null;
  new_capital: boolean;
  tier: SourceTier;
  summary: string | null;
  published_at: string;
  signal_type: string | null;
  url: string;
  why: string | null;
  confidence: string | null;
  relevance: number | null;
}

export interface PipelineRow {
  id: string;
  firm_name: string;
  /** Synthetic demo investor (never real intelligence). */
  is_demo: boolean;
  /** Where a draft can be opened in the founder's own mail app. Null for real investors: contact details are never invented. */
  contact_email: string | null;
  entity_type: string;
  role_title: string | null;
  sectors: string[];
  stage_preference: string | null;
  geography: string | null;
  relationship_status: string;
  /** Founder-entered; used for follow-up cadence (read-only here). */
  last_contact_date: string | null;
  follow_up_score: number | null;
  recommended_action: string | null;
  last_signal_date: string | null;
  signal_summary: string | null;
  website_url: string | null;
  verification_status: string;
  state: InvestorState;
  refresh_failed: boolean; // latest attempt failed (even if older signals keep the state "active")
  needs_review_signals: number;
  relevant_30d: number;
  lead: LeadSignal | null;
  explanation: string | null;
  breakdown: Record<string, { points: number; max: number; note: string }> | null;
  /** Suggested opening, grounded in the lead signal (only for "reach out now"). */
  angle: string | null;
  /** Reasons a score high enough for "reach out now" was held at a lower action. */
  capped_by: string[];
  /** What the investor already backs, from its own portfolio page (informational; null = not checked or unreadable). */
  portfolio: { total: number; logistics: number; direct: number } | null;
  last_checked: string | null;
  last_error: string | null; // why the latest refresh failed, if it did
}

interface RawRow extends Omit<PipelineRow, "state" | "refresh_failed" | "lead" | "explanation" | "breakdown" | "angle" | "capped_by" | "portfolio" | "last_checked" | "last_error"> {
  pf_total: number;
  pf_logistics: number;
  pf_direct: number;
  latest_status: string | null;
  latest_error: string | null;
  latest_finished: Date | string | null;
  latest_outcome: { explanation?: string; coverage?: string; breakdown?: PipelineRow["breakdown"] } | null;
  h_explanation: string | null;
  h_breakdown: PipelineRow["breakdown"];
  h_angle: string | null;
  h_capped: string[] | null;
  lead_raw_headline: string | null;
  lead_sector: SectorMatch | null;
  lead_new_capital: boolean | null;
  lead_source: string | null;
  last_relevant: string | null;
  lead_headline: string | null;
  lead_summary: string | null;
  lead_published: string | null;
  lead_type: string | null;
  lead_url: string | null;
  lead_why: string | null;
  lead_conf: string | null;
  lead_relevance: number | null;
}

/** `demo` selects which universe to read: real investors (default) or the synthetic demo investors. They are never mixed. */
export async function listPipeline(db: Db, today: string, demo: Scope = false): Promise<PipelineRow[]> {
  const { rows } = await db.query<RawRow>(
    `select i.id, i.firm_name, i.is_demo, i.contact_email, i.entity_type, i.role_title, i.sectors, i.stage_preference, i.geography, i.relationship_status, i.last_contact_date::text as last_contact_date,
            i.follow_up_score, i.recommended_action, i.last_signal_date::text as last_signal_date, i.signal_summary,
            i.website_url, i.verification_status,
            li.status as latest_status, li.error as latest_error, li.finished_at as latest_finished, li.outcome as latest_outcome,
            pf.total as pf_total, pf.logistics as pf_logistics, pf.direct as pf_direct,
            sh.explanation as h_explanation, sh.breakdown as h_breakdown, sh.angle as h_angle, sh.capped_by as h_capped,
            coalesce(sg.relevant_30d, 0)::int as relevant_30d, coalesce(sg.needs_review, 0)::int as needs_review_signals,
            sg.last_relevant::text as last_relevant,
            coalesce(ld.display_headline, ld.headline) as lead_headline, case when ld.display_headline is not null then ld.headline end as lead_raw_headline,
            ld.sector_match as lead_sector, ld.new_capital as lead_new_capital, ld.source_name as lead_source, ld.summary as lead_summary, ld.published_at as lead_published, ld.signal_type as lead_type,
            ld.url as lead_url, ld.relevance_explanation as lead_why, ld.evidence_confidence as lead_conf, ld.relevance_score as lead_relevance
       from investors i
       left join (select distinct on (investor_id) investor_id, status, error, finished_at, outcome
                    from run_items where status in ('done', 'failed')
                   order by investor_id, finished_at desc nulls last) li on li.investor_id = i.id
       left join (select investor_id,
                         count(*) filter (where verification_status = 'verified' and duplicate_of is null
                                            and published_at >= $1::date and ${effRel("signals")} >= ${RELEVANCE_MIN}) as relevant_30d,
                         count(*) filter (where verification_status = 'needs_review') as needs_review,
                         max(published_at) filter (where verification_status = 'verified' and duplicate_of is null
                                            and ${effRel("signals")} >= ${RELEVANCE_MIN}) as last_relevant
                    from signals group by investor_id) sg on sg.investor_id = i.id
       left join (select investor_id, count(*)::int as total, (count(*) filter (where logistics_related))::int as logistics, (count(*) filter (where competitor_risk = 'direct'))::int as direct
                    from portfolio_companies group by investor_id) pf on pf.investor_id = i.id
       left join (select distinct on (investor_id) investor_id, explanation, breakdown, lead_signal_id, capped_by, angle
                    from score_history order by investor_id, at desc, id desc) sh on sh.investor_id = i.id
       -- The lead shown on the card is the signal the SCORE was computed from; if that has aged out, the newest relevant one.
       left join lateral (select s.headline, s.display_headline, s.summary, s.published_at::text as published_at, s.signal_type, s.url,
                                 s.relevance_explanation, s.evidence_confidence, s.relevance_score, s.sector_match, s.new_capital, s.source_name
                            from signals s
                           where s.investor_id = i.id and s.verification_status = 'verified' and s.duplicate_of is null
                             and s.published_at >= $1::date and ${effRel("s")} >= ${RELEVANCE_MIN}
                           order by (s.id = sh.lead_signal_id) desc, s.published_at desc, s.relevance_score desc
                           limit 1) ld on true
      where ${inScope("$2")}`,
    [windowStart(new Date(`${today}T00:00:00Z`)), scopeKey(demo)],
  );

  return rows.map((r): PipelineRow => {
    const latestFailed = r.latest_status === "failed";
    const state = deriveState(
      {
        relevant_30d: r.relevant_30d,
        has_item: r.latest_status !== null,
        latest_failed: latestFailed,
        partial: r.latest_outcome?.coverage === "partial",
        last_relevant: r.last_relevant,
      },
      today,
    );
    const { latest_status, latest_error, latest_finished, latest_outcome, last_relevant, lead_headline, lead_summary, lead_published, lead_type, lead_url, lead_why, lead_conf, lead_relevance,
      h_explanation, h_breakdown, h_angle, h_capped, lead_raw_headline, lead_sector, lead_new_capital, lead_source, pf_total, pf_logistics, pf_direct, ...rest } = r;
    void latest_status; void last_relevant;
    return {
      ...rest,
      state,
      refresh_failed: latestFailed,
      lead: lead_headline && lead_url && lead_published
        ? {
            headline: lead_headline, raw_headline: lead_raw_headline, summary: lead_summary, published_at: lead_published, signal_type: lead_type, url: lead_url,
            why: lead_why, confidence: lead_conf, relevance: lead_relevance, sector_match: lead_sector, new_capital: !!lead_new_capital, tier: sourceTier(lead_source, r.website_url),
          }
        : null,
      explanation: h_explanation ?? latest_outcome?.explanation ?? null,
      breakdown: h_breakdown ?? latest_outcome?.breakdown ?? null,
      angle: r.recommended_action === "reach_out_now" ? h_angle : null,
      capped_by: h_capped ?? [],
      portfolio: pf_total ? { total: pf_total, logistics: pf_logistics, direct: pf_direct } : null,
      last_checked: latest_finished ? new Date(latest_finished).toISOString() : null,
      last_error: latestFailed ? latest_error : null,
    };
  });
}

// ───────────────────────────── filtering / sorting ─────────────────────────────

export interface PipelineFilters {
  q?: string;
  entity?: string;
  sector?: string;
  stage?: string;
  relationship?: string;
  category?: string;
  freshness?: string; // "7" | "14" | "30" | "none"
  priority?: string; // "high" | "medium" | "low" | "unscored"
  state?: string; // "active" | "quiet" | "review" | "failed"
  action?: string; // a recommended_action value
  sort?: string; // "score" | "recent" | "name"
}

export const PRIORITY = { high: ACTION_THRESHOLDS.reachOutNow, medium: ACTION_THRESHOLDS.prepareOutreach } as const;

export function priorityOf(score: number | null): "high" | "medium" | "low" | "unscored" {
  if (score === null) return "unscored";
  return score >= PRIORITY.high ? "high" : score >= PRIORITY.medium ? "medium" : "low";
}

/** Coarse stage buckets, consistent with how the scoring engine reads stage text. */
export function stageBucket(stage: string | null): "seed" | "early" | "growth" | "unknown" {
  const s = (stage ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/seed|angel|accelerator|very early/.test(s)) return "seed";
  if (/early/.test(s) && !/early growth/.test(s)) return "early";
  if (/series a|growth|scale/.test(s)) return "growth";
  return "unknown";
}

/** The four user-facing statuses the brief asks for. */
export function displayStatus(state: InvestorState): "active" | "quiet" | "review" | "failed" {
  if (state === "active") return "active";
  if (state === "failed") return "failed";
  if (state === "quiet_partial" || state === "not_checked") return "review";
  return "quiet";
}

export function filterPipeline(rows: PipelineRow[], f: PipelineFilters, today: string): PipelineRow[] {
  const now = new Date(`${today}T00:00:00Z`);
  const q = f.q?.trim().toLowerCase();
  const out = rows.filter((r) => {
    if (q && !`${r.firm_name} ${r.role_title ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.entity && r.entity_type !== f.entity) return false;
    if (f.sector && !r.sectors.some((s) => s.toLowerCase() === f.sector!.toLowerCase())) return false;
    if (f.stage && stageBucket(r.stage_preference) !== f.stage) return false;
    if (f.relationship && r.relationship_status !== f.relationship) return false;
    if (f.category && r.lead?.signal_type !== f.category) return false;
    if (f.priority && priorityOf(r.follow_up_score) !== f.priority) return false;
    if (f.action && r.recommended_action !== f.action) return false;
    if (f.state && displayStatus(r.state) !== f.state) return false;
    if (f.freshness === "none") { if (r.lead) return false; }
    else if (f.freshness) {
      if (!r.lead || ageInDays(r.lead.published_at, now) > Number(f.freshness)) return false;
    }
    return true;
  });
  const byName = (a: PipelineRow, b: PipelineRow) => a.firm_name.localeCompare(b.firm_name);
  const score = (r: PipelineRow) => r.follow_up_score ?? -1;
  const recent = (r: PipelineRow) => r.last_signal_date ?? "";
  const realFirst = (a: PipelineRow, b: PipelineRow) => Number(a.is_demo) - Number(b.is_demo); // synthetic accounts never outrank real investors
  if (f.sort === "name") out.sort(byName);
  else if (f.sort === "recent") out.sort((a, b) => realFirst(a, b) || recent(b).localeCompare(recent(a)) || score(b) - score(a) || byName(a, b));
  else out.sort((a, b) => realFirst(a, b) || score(b) - score(a) || recent(b).localeCompare(recent(a)) || byName(a, b));
  return out;
}

export function sectorOptions(rows: PipelineRow[], limit = 30): string[] {
  const n = new Map<string, number>();
  for (const r of rows) for (const s of new Set(r.sectors.map((x) => x.toLowerCase()))) n.set(s, (n.get(s) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([s]) => s);
}

// ───────────────────────────── signals feed ─────────────────────────────

export interface FeedSignal {
  id: string;
  investor_id: string;
  firm_name: string;
  headline: string;
  source_name: string | null;
  url: string;
  published_at: string | null;
  retrieved_at: string;
  signal_type: string | null;
  evidence_excerpt: string | null;
  summary: string | null;
  relevance_explanation: string | null;
  relevance_score: number | null;
  evidence_confidence: string | null;
  date_source: string | null;
  verification_status: string;
  rejection_reason: string | null;
  duplicates: number;
  new_capital: boolean;
  investor_website: string | null;
  sector_match: SectorMatch | null;
  firm_acting: boolean | null;
  review_note: string | null;
  is_demo: boolean;
  /** The page's own title, when `headline` was rewritten by the review pass. */
  raw_headline: string | null;
}

export interface FeedFilters {
  category?: string;
  investor?: string;
  show?: string; // "relevant" (default) | "verified" | "review"
}

export async function listSignals(db: Db, today: string, f: FeedFilters = {}, demo: Scope = false): Promise<FeedSignal[]> {
  const show = f.show ?? "relevant";
  const { rows } = await db.query<FeedSignal>(
    `select s.id, s.investor_id, i.firm_name, coalesce(s.display_headline, s.headline) as headline, case when s.display_headline is not null then s.headline end as raw_headline,
            s.source_name, s.url, s.published_at::text as published_at,
            s.retrieved_at::text as retrieved_at, s.signal_type, s.evidence_excerpt, s.summary, s.relevance_explanation,
            s.relevance_score, s.evidence_confidence, s.date_source, s.verification_status, s.rejection_reason, s.new_capital, i.website_url as investor_website,
            s.sector_match, s.firm_acting, s.review_note, i.is_demo,
            (select count(*)::int from signals d where d.duplicate_of = s.id) as duplicates
       from signals s join investors i on i.id = s.investor_id
      where s.duplicate_of is null and ${inScope("$5")}
        and ( ($1 = 'review' and s.verification_status = 'needs_review')
           or ($1 <> 'review' and s.verification_status = 'verified' and s.published_at >= $2::date
               and ($1 = 'verified' or ${effRel("s")} >= ${RELEVANCE_MIN})) )
        and ($3::text is null or s.signal_type = $3)
        and ($4::uuid is null or s.investor_id = $4)
      order by s.published_at desc nulls last, s.relevance_score desc nulls last
      limit 300`,
    [show, windowStart(new Date(`${today}T00:00:00Z`)), f.category ?? null, f.investor ?? null, scopeKey(demo)],
  );
  return rows;
}

// ───────────────────────────── investor detail ─────────────────────────────

export async function getInvestor(db: Db, id: string, today: string) {
  const inv = (await db.query(
    `select id, entity_type, entity_type_source, firm_name, aliases, role_title, website_url, profile_url, investment_thesis, thesis_verified,
            fit_rationale, sectors, stage_preference, geography, notable_investments, source_urls, source_ref, verification_status,
            verification_note, data_flags, partner_name, partner_profile_url, last_contact_date::text as last_contact_date,
            relationship_status, contact_history, personal_notes, last_signal_date::text as last_signal_date, signal_summary,
            follow_up_score, recommended_action, is_demo, contact_email
       from investors where id = $1`,
    [id],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!inv) return null;
  const signals = (await db.query<FeedSignal>(
    `select s.id, s.investor_id, i.firm_name, coalesce(s.display_headline, s.headline) as headline, case when s.display_headline is not null then s.headline end as raw_headline,
            s.source_name, s.url, s.published_at::text as published_at, s.retrieved_at::text as retrieved_at,
            s.signal_type, s.evidence_excerpt, s.summary, s.relevance_explanation, s.relevance_score, s.evidence_confidence, s.date_source,
            s.verification_status, s.rejection_reason, s.new_capital, i.website_url as investor_website, s.sector_match, s.firm_acting, s.review_note, i.is_demo,
            (select count(*)::int from signals d where d.duplicate_of = s.id) as duplicates
       from signals s join investors i on i.id = s.investor_id
      where s.investor_id = $1 and s.duplicate_of is null
      order by s.published_at desc nulls last, s.retrieved_at desc`,
    [id],
  )).rows;
  const latest = (await db.query<{ status: string; error: string | null; finished_at: string | null; outcome: Record<string, any> | null }>(
    `select status, error, finished_at::text as finished_at, outcome from run_items
      where investor_id = $1 and status in ('done','failed') order by finished_at desc nulls last limit 1`,
    [id],
  )).rows[0] ?? null;
  const coverage = (await db.query<{ source: string; checked_at: string; status: string; result_count: number; error_category: string | null; note: string | null }>(
    `select source, checked_at::text as checked_at, status, result_count, error_category, note from source_coverage where investor_id = $1 order by source`,
    [id],
  )).rows;
  const state = deriveState(
    {
      relevant_30d: signals.filter((s) => s.verification_status === "verified" && Math.min(s.relevance_score ?? 0, s.sector_match ? DEFAULT_CONFIG.sectorCap[s.sector_match] : 100) >= RELEVANCE_MIN && s.published_at && s.published_at >= windowStart(new Date(`${today}T00:00:00Z`))).length,
      has_item: latest !== null,
      latest_failed: latest?.status === "failed",
      partial: latest?.outcome?.coverage === "partial",
      last_relevant: (inv.last_signal_date as string | null) ?? null,
    },
    today,
  );
  const history = (await db.query<{ at: string; source: "refresh" | "rescore"; score: number; action: string; explanation: string | null; breakdown: Record<string, { points: number; max: number; note: string }> | null; capped_by: string[]; angle: string | null }>(
    `select at::text as at, source, score, action, explanation, breakdown, capped_by, angle from score_history where investor_id = $1 order by at desc, id desc limit 40`,
    [id],
  )).rows;
  const portfolio = (await db.query<{ company: string; description: string | null; logistics_related: boolean; competitor_risk: "direct" | "adjacent" | "none"; evidence: string | null; source_url: string; checked_at: string }>(
    `select company, description, logistics_related, competitor_risk, evidence, source_url, checked_at::text as checked_at from portfolio_companies
      where investor_id = $1 order by (competitor_risk = 'direct') desc, logistics_related desc, company`,
    [id],
  )).rows;
  return { inv, signals, latest, coverage, state, history, portfolio };
}

// ───────────────────────────── runs / overview ─────────────────────────────

export interface RunRow {
  id: string; trigger_type: string; status: string; started_at: string; heartbeat_at: string; completed_at: string | null;
  investors_total: number; investors_processed: number; sources_checked: number; signals_discovered: number; signals_accepted: number;
  duplicates_removed: number; records_updated: number; error_count: number; search_calls: number; skipped: number; summary: string | null; error_details: { investor_id?: string; error?: string; attempt?: number; final?: boolean }[];
}

const RUN_COLS = `id, trigger_type, status, started_at::text as started_at, heartbeat_at::text as heartbeat_at, completed_at::text as completed_at,
  investors_total, investors_processed, sources_checked, signals_discovered, signals_accepted, duplicates_removed, records_updated, error_count, search_calls, skipped, summary, error_details`;

export async function listRuns(db: Db, limit = 25, demo = false): Promise<RunRow[]> {
  return (await db.query<RunRow>(`select ${RUN_COLS} from runs where is_demo = $2 order by started_at desc limit $1`, [limit, demo])).rows;
}

export async function getOverview(db: Db, today: string, demo: Scope = false) {
  const pipeline = await listPipeline(db, today, demo);
  const onlyDemo = demo === true;
  const runs = await listRuns(db, 5, onlyDemo);
  const active = runs.find((r) => r.status === "running") ?? null;
  const lastGood = (await db.query<{ completed_at: string; status: string }>(
    `select completed_at::text as completed_at, status from runs where status in ('succeeded','partial') and is_demo = $1 order by completed_at desc limit 1`, [onlyDemo],
  )).rows[0] ?? null;
  // Counts describe the REAL pipeline (or the demo universe when viewing only demo): synthetic accounts shown alongside never inflate them.
  const counted = pipeline.filter((p) => onlyDemo || !p.is_demo);
  const byDisplay = { active: 0, quiet: 0, review: 0, failed: 0 };
  for (const p of counted) byDisplay[displayStatus(p.state)]++;
  return { pipeline, runs, active, lastGood, counts: { total: counted.length, ...byDisplay }, demoCount: pipeline.length - counted.length };
}

export async function getCoverageSummary(db: Db, demo = false) {
  return (await db.query<{ source: string; status: string; n: number }>(
    `select c.source, c.status, count(*)::int as n from source_coverage c join investors i on i.id = c.investor_id where i.is_demo = $1 group by c.source, c.status order by c.source, c.status`, [demo],
  )).rows;
}

export async function getFailedItems(db: Db, runId: string) {
  return (await db.query<{ investor_id: string; firm_name: string; error: string | null; attempts: number }>(
    `select ri.investor_id, i.firm_name, ri.error, ri.attempts from run_items ri join investors i on i.id = ri.investor_id
      where ri.run_id = $1 and ri.status = 'failed' order by i.firm_name`,
    [runId],
  )).rows;
}

/** Small query for the global status bar: current run and last completed refresh. */
export async function getRunBar(db: Db, demo = false) {
  const [run] = await listRuns(db, 1, demo);
  const lastGood = (await db.query<{ completed_at: string; status: string; error_count: number }>(
    `select completed_at::text as completed_at, status, error_count from runs where status in ('succeeded','partial') and is_demo = $1 order by completed_at desc limit 1`, [demo],
  )).rows[0] ?? null;
  const total = (await db.query<{ n: number }>(`select count(*)::int as n from investors where is_demo = $1`, [demo])).rows[0]!.n;
  return { latest: run ?? null, active: run?.status === "running" ? run : null, lastGood, total };
}

export interface AuditRow {
  id: string; at: string; run_id: string | null; firm_name: string | null; level: string; event: string; detail: Record<string, unknown>;
}

/** Recent audit events. `detail` never contains notes or contact history (nothing in the pipeline can read them). */
export async function listAudit(db: Db, limit = 40, demo = false): Promise<AuditRow[]> {
  return (await db.query<AuditRow>(
    `select a.id::text as id, a.at::text as at, a.run_id, i.firm_name, a.level, a.event, a.detail
       from audit_logs a left join investors i on i.id = a.investor_id left join runs r on r.id = a.run_id
      where coalesce(i.is_demo, r.is_demo, false) = $2 order by a.at desc, a.id desc limit $1`,
    [limit, demo],
  )).rows;
}
