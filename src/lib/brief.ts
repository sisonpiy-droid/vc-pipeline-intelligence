import type { Db } from "@/lib/db";
import { ACTION_THRESHOLDS, RELEVANCE_MIN } from "@/lib/scoring/score";
import { windowStart } from "@/lib/signals/window";
import { cadence, type Cadence } from "./cadence";
import { effRel, listPipeline, type PipelineRow } from "./read";

/**
 * "What changed since last time" — the weekly brief. Everything here is derived from stored run outcomes, so it
 * can be re-computed at any time and never invents movement: a mover needs two real checks of the same investor.
 */
export interface BriefRun {
  id: string;
  trigger_type: string;
  status: string;
  completed_at: string;
  investors_total: number;
  skipped: number;
  search_calls: number;
}

export interface Mover {
  id: string;
  firm_name: string;
  score: number;
  prev_score: number | null;
  delta: number | null;
  action: string | null;
  prev_action: string | null;
  is_new: boolean;
}

export interface NewSignal {
  investor_id: string;
  firm_name: string;
  headline: string;
  summary: string | null;
  url: string;
  published_at: string;
  signal_type: string | null;
  relevance_score: number;
  source_name: string | null;
  new_capital: boolean;
}

export interface Brief {
  run: BriefRun | null;
  previous: BriefRun | null;
  newSignals: NewSignal[];
  movers: Mover[];
  contact: PipelineRow[];
  prepare: PipelineRow[];
  hold: PipelineRow[];
  attention: PipelineRow[];
  /** Investors you have already contacted whose follow-up is due today (your data, read-only). */
  followUps: { row: PipelineRow; cadence: Cadence }[];
  counts: { active: number; total: number };
}

const MOVE_MIN = 5; // points; smaller changes are noise between runs

export async function getBrief(db: Db, today: string): Promise<Brief> {
  const runs = (await db.query<BriefRun>(
    `select id, trigger_type, status, completed_at::text as completed_at, investors_total, skipped, search_calls
       from runs where status in ('succeeded', 'partial') and investors_total > 0 order by completed_at desc limit 2`,
  )).rows;
  const run = runs[0] ?? null;
  const pipeline = await listPipeline(db, today);

  let movers: Mover[] = [];
  let newSignals: NewSignal[] = [];
  if (run) {
    const raw = (await db.query<{ id: string; firm_name: string; score: number; prev_score: number | null; action: string | null; prev_action: string | null }>(
      `with r as (
         select investor_id, run_id, (outcome->>'score')::int as sc, outcome->>'action' as act,
                row_number() over (partition by investor_id order by finished_at desc) as rn
           from run_items where status = 'done' and outcome->>'score' is not null)
       select i.id, i.firm_name, a.sc as score, b.sc as prev_score, a.act as action, b.act as prev_action
         from r a join investors i on i.id = a.investor_id
         left join r b on b.investor_id = a.investor_id and b.rn = 2
        where a.rn = 1 and a.run_id = $1`,
      [run.id],
    )).rows;
    movers = raw
      .map((m): Mover => ({ ...m, delta: m.prev_score === null ? null : m.score - m.prev_score, is_new: m.prev_score === null }))
      .filter((m) => (m.delta !== null && Math.abs(m.delta) >= MOVE_MIN) || (m.action !== m.prev_action && m.prev_action !== null) || (m.is_new && m.score >= ACTION_THRESHOLDS.prepareOutreach))
      .sort((a, b) => Math.abs(b.delta ?? b.score) - Math.abs(a.delta ?? a.score));

    newSignals = (await db.query<NewSignal>(
      `select s.investor_id, i.firm_name, s.headline, s.summary, s.url, s.published_at::text as published_at, s.signal_type,
              s.relevance_score, s.source_name, s.new_capital
         from signals s join investors i on i.id = s.investor_id
        where s.run_id = $1 and s.verification_status = 'verified' and s.duplicate_of is null
          and ${effRel("s")} >= ${RELEVANCE_MIN} and s.published_at >= $2::date
        order by s.relevance_score desc, s.published_at desc limit 12`,
      [run.id, windowStart(new Date(`${today}T00:00:00Z`))],
    )).rows;
  }

  const active = pipeline.filter((r) => r.state === "active");
  const holdIt = (r: PipelineRow) => r.recommended_action === "wait_for_response" || r.relationship_status === "passed" || r.relationship_status === "committed";
  const byScore = (a: PipelineRow, b: PipelineRow) => (b.follow_up_score ?? 0) - (a.follow_up_score ?? 0);
  return {
    run,
    previous: runs[1] ?? null,
    newSignals,
    movers,
    contact: active.filter((r) => !holdIt(r) && r.recommended_action === "reach_out_now").sort(byScore),
    prepare: active.filter((r) => !holdIt(r) && r.recommended_action === "prepare_targeted_outreach").sort(byScore),
    hold: active.filter(holdIt).sort(byScore),
    attention: pipeline.filter((r) => r.state === "failed" || r.state === "quiet_partial" || r.state === "not_checked"),
    followUps: pipeline.flatMap((row) => { const c = cadence(row.relationship_status, row.last_contact_date, today); return c?.due ? [{ row, cadence: c }] : []; }).sort((a, b) => (b.cadence.days ?? 0) - (a.cadence.days ?? 0)),
    counts: { active: active.length, total: pipeline.length },
  };
}

// ───────────────────────────── evidence funnel ─────────────────────────────

export interface FunnelStage {
  key: string;
  label: string;
  count: number; // candidates still alive after this stage
  dropped: number;
  note: string;
}

const GROUPS: { key: string; label: string; reasons: string[]; note: string }[] = [
  { key: "named", label: "Names the investor", reasons: ["entity_not_mentioned", "invalid_url"], note: "Dropped: the page does not name the investor (or the URL is invalid)." },
  { key: "page", label: "An event, not a profile page", reasons: ["profile_or_directory_page"], note: "Dropped: static profile / directory pages (Crunchbase, LinkedIn profiles, …)." },
  { key: "date", label: "Dated inside the 30-day window", reasons: ["missing_date", "out_of_window", "future_date", "contradictory_dates", "page_unavailable"], note: "Dropped: undated, too old, future, or contradictory dates (or a page that could not be read: retried next run)." },
  { key: "dedupe", label: "Distinct events", reasons: ["duplicate_event", "over_candidate_cap", "insufficient_content"], note: "Dropped: repeat coverage of the same event, or too little content." },
  { key: "ai", label: "Verified by Gemini and in code", reasons: ["investor_not_involved", "investor_unclear", "not_a_specific_event", "excerpt_not_in_source", "second_pass_not_acting"], note: "Dropped: investor not actually involved, not a specific event, the quote was not in the source, or the second-pass review found it was a different firm." },
];

/** Where the candidates found by one run were filtered out. Counts come from the stored verdict of every candidate. */
export async function getFunnel(db: Db, runId: string): Promise<{ total: number; stages: FunnelStage[]; review: number; relevant: number }> {
  const rows = (await db.query<{ s: string; r: string; rel: boolean; n: number }>(
    `select verification_status as s, coalesce(rejection_reason, '-') as r, coalesce(${effRel("signals")} >= ${RELEVANCE_MIN}, false) as rel, count(*)::int as n
       from signals where run_id = $1 group by 1, 2, 3`,
    [runId],
  )).rows;
  const total = rows.reduce((s, r) => s + r.n, 0);
  let alive = total;
  const stages: FunnelStage[] = [{ key: "found", label: "Candidates found", count: total, dropped: 0, note: "Every page the searches returned that was not already judged on an earlier run." }];
  for (const g of GROUPS) {
    const dropped = rows.filter((r) => g.reasons.includes(r.r)).reduce((s, r) => s + r.n, 0);
    alive -= dropped;
    stages.push({ key: g.key, label: g.label, count: alive, dropped, note: g.note });
  }
  const review = rows.filter((r) => r.s === "needs_review").reduce((s, r) => s + r.n, 0);
  const relevant = rows.filter((r) => r.s === "verified" && r.rel).reduce((s, r) => s + r.n, 0);
  return { total, stages, review, relevant };
}

// ───────────────────────────── free-tier budget ─────────────────────────────

export async function getBudget(db: Db, budget: number, baseline: number) {
  const used = (await db.query<{ n: number }>(`select coalesce(sum(search_calls), 0)::int as n from runs where started_at >= date_trunc('month', now())`)).rows[0]!.n;
  const spent = used + baseline;
  return { budget, baseline, tracked: used, spent, remaining: Math.max(0, budget - spent), pct: Math.min(100, Math.round((spent / Math.max(1, budget)) * 100)) };
}
