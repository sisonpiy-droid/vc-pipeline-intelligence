import type { Db } from "@/lib/db";
import { RELEVANCE_MIN } from "@/lib/scoring/score";
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

export interface LeadSignal {
  headline: string;
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
  entity_type: string;
  role_title: string | null;
  sectors: string[];
  stage_preference: string | null;
  geography: string | null;
  relationship_status: string;
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
  last_checked: string | null;
}

interface RawRow extends Omit<PipelineRow, "state" | "refresh_failed" | "lead" | "explanation" | "last_checked"> {
  latest_status: string | null;
  latest_finished: Date | string | null;
  latest_outcome: { explanation?: string; coverage?: string } | null;
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

export async function listPipeline(db: Db, today: string): Promise<PipelineRow[]> {
  const { rows } = await db.query<RawRow>(
    `select i.id, i.firm_name, i.entity_type, i.role_title, i.sectors, i.stage_preference, i.geography, i.relationship_status,
            i.follow_up_score, i.recommended_action, i.last_signal_date::text as last_signal_date, i.signal_summary,
            i.website_url, i.verification_status,
            li.status as latest_status, li.finished_at as latest_finished, li.outcome as latest_outcome,
            coalesce(sg.relevant_30d, 0)::int as relevant_30d, coalesce(sg.needs_review, 0)::int as needs_review_signals,
            sg.last_relevant::text as last_relevant,
            ld.headline as lead_headline, ld.summary as lead_summary, ld.published_at as lead_published, ld.signal_type as lead_type,
            ld.url as lead_url, ld.relevance_explanation as lead_why, ld.evidence_confidence as lead_conf, ld.relevance_score as lead_relevance
       from investors i
       left join (select distinct on (investor_id) investor_id, status, finished_at, outcome
                    from run_items where status in ('done', 'failed')
                   order by investor_id, finished_at desc nulls last) li on li.investor_id = i.id
       left join (select investor_id,
                         count(*) filter (where verification_status = 'verified' and duplicate_of is null
                                            and published_at >= $1::date and relevance_score >= ${RELEVANCE_MIN}) as relevant_30d,
                         count(*) filter (where verification_status = 'needs_review') as needs_review,
                         max(published_at) filter (where verification_status = 'verified' and duplicate_of is null
                                            and relevance_score >= ${RELEVANCE_MIN}) as last_relevant
                    from signals group by investor_id) sg on sg.investor_id = i.id
       left join lateral (select s.headline, s.summary, s.published_at::text as published_at, s.signal_type, s.url,
                                 s.relevance_explanation, s.evidence_confidence, s.relevance_score
                            from signals s
                           where s.investor_id = i.id and s.verification_status = 'verified' and s.duplicate_of is null
                             and s.published_at >= $1::date and s.relevance_score >= ${RELEVANCE_MIN}
                           order by s.published_at desc, s.relevance_score desc
                           limit 1) ld on true`,
    [windowStart(new Date(`${today}T00:00:00Z`))],
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
    const { latest_status, latest_finished, latest_outcome, last_relevant, lead_headline, lead_summary, lead_published, lead_type, lead_url, lead_why, lead_conf, lead_relevance, ...rest } = r;
    void latest_status; void last_relevant;
    return {
      ...rest,
      state,
      refresh_failed: latestFailed,
      lead: lead_headline && lead_url && lead_published
        ? { headline: lead_headline, summary: lead_summary, published_at: lead_published, signal_type: lead_type, url: lead_url, why: lead_why, confidence: lead_conf, relevance: lead_relevance }
        : null,
      explanation: latest_outcome?.explanation ?? null,
      last_checked: latest_finished ? new Date(latest_finished).toISOString() : null,
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
  sort?: string; // "score" | "recent" | "name"
}

export const PRIORITY = { high: 70, medium: 50 } as const;

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
  if (f.sort === "name") out.sort(byName);
  else if (f.sort === "recent") out.sort((a, b) => recent(b).localeCompare(recent(a)) || score(b) - score(a) || byName(a, b));
  else out.sort((a, b) => score(b) - score(a) || recent(b).localeCompare(recent(a)) || byName(a, b));
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
}

export interface FeedFilters {
  category?: string;
  investor?: string;
  show?: string; // "relevant" (default) | "verified" | "review"
}

export async function listSignals(db: Db, today: string, f: FeedFilters = {}): Promise<FeedSignal[]> {
  const show = f.show ?? "relevant";
  const { rows } = await db.query<FeedSignal>(
    `select s.id, s.investor_id, i.firm_name, s.headline, s.source_name, s.url, s.published_at::text as published_at,
            s.retrieved_at::text as retrieved_at, s.signal_type, s.evidence_excerpt, s.summary, s.relevance_explanation,
            s.relevance_score, s.evidence_confidence, s.date_source, s.verification_status, s.rejection_reason,
            (select count(*)::int from signals d where d.duplicate_of = s.id) as duplicates
       from signals s join investors i on i.id = s.investor_id
      where s.duplicate_of is null
        and ( ($1 = 'review' and s.verification_status = 'needs_review')
           or ($1 <> 'review' and s.verification_status = 'verified' and s.published_at >= $2::date
               and ($1 = 'verified' or s.relevance_score >= ${RELEVANCE_MIN})) )
        and ($3::text is null or s.signal_type = $3)
        and ($4::uuid is null or s.investor_id = $4)
      order by s.published_at desc nulls last, s.relevance_score desc nulls last
      limit 300`,
    [show, windowStart(new Date(`${today}T00:00:00Z`)), f.category ?? null, f.investor ?? null],
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
            follow_up_score, recommended_action
       from investors where id = $1`,
    [id],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!inv) return null;
  const signals = (await db.query<FeedSignal>(
    `select s.id, s.investor_id, i.firm_name, s.headline, s.source_name, s.url, s.published_at::text as published_at, s.retrieved_at::text as retrieved_at,
            s.signal_type, s.evidence_excerpt, s.summary, s.relevance_explanation, s.relevance_score, s.evidence_confidence, s.date_source,
            s.verification_status, s.rejection_reason, (select count(*)::int from signals d where d.duplicate_of = s.id) as duplicates
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
      relevant_30d: signals.filter((s) => s.verification_status === "verified" && (s.relevance_score ?? 0) >= RELEVANCE_MIN && s.published_at && s.published_at >= windowStart(new Date(`${today}T00:00:00Z`))).length,
      has_item: latest !== null,
      latest_failed: latest?.status === "failed",
      partial: latest?.outcome?.coverage === "partial",
      last_relevant: (inv.last_signal_date as string | null) ?? null,
    },
    today,
  );
  return { inv, signals, latest, coverage, state };
}

// ───────────────────────────── runs / overview ─────────────────────────────

export interface RunRow {
  id: string; trigger_type: string; status: string; started_at: string; heartbeat_at: string; completed_at: string | null;
  investors_total: number; investors_processed: number; sources_checked: number; signals_discovered: number; signals_accepted: number;
  duplicates_removed: number; records_updated: number; error_count: number; summary: string | null; error_details: { investor_id?: string; error?: string; attempt?: number; final?: boolean }[];
}

const RUN_COLS = `id, trigger_type, status, started_at::text as started_at, heartbeat_at::text as heartbeat_at, completed_at::text as completed_at,
  investors_total, investors_processed, sources_checked, signals_discovered, signals_accepted, duplicates_removed, records_updated, error_count, summary, error_details`;

export async function listRuns(db: Db, limit = 25): Promise<RunRow[]> {
  return (await db.query<RunRow>(`select ${RUN_COLS} from runs order by started_at desc limit $1`, [limit])).rows;
}

export async function getOverview(db: Db, today: string) {
  const pipeline = await listPipeline(db, today);
  const runs = await listRuns(db, 5);
  const active = runs.find((r) => r.status === "running") ?? null;
  const lastGood = (await db.query<{ completed_at: string; status: string }>(
    `select completed_at::text as completed_at, status from runs where status in ('succeeded','partial') order by completed_at desc limit 1`,
  )).rows[0] ?? null;
  const byDisplay = { active: 0, quiet: 0, review: 0, failed: 0 };
  for (const p of pipeline) byDisplay[displayStatus(p.state)]++;
  return { pipeline, runs, active, lastGood, counts: { total: pipeline.length, ...byDisplay } };
}

export async function getCoverageSummary(db: Db) {
  return (await db.query<{ source: string; status: string; n: number }>(
    `select source, status, count(*)::int as n from source_coverage group by source, status order by source, status`,
  )).rows;
}

export async function getFailedItems(db: Db, runId: string) {
  return (await db.query<{ investor_id: string; firm_name: string; error: string | null; attempts: number }>(
    `select ri.investor_id, i.firm_name, ri.error, ri.attempts from run_items ri join investors i on i.id = ri.investor_id
      where ri.run_id = $1 and ri.status = 'failed' order by i.firm_name`,
    [runId],
  )).rows;
}
