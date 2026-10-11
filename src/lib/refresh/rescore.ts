import { generateAngle } from "@/lib/ai/angle";
import type { AiClient } from "@/lib/ai/gemini";
import type { Db, Queryable } from "@/lib/db";
import { sourceTier } from "@/lib/format";
import { effectiveRelevance, RELEVANCE_MIN, scoreInvestor, STARTUP, type Confidence, type ScoredSignal, type ScoreResult, type SectorMatch } from "@/lib/scoring/score";
import { ageInDays } from "@/lib/signals/window";
import type { InvestorRow } from "./research";
import { applySignalUpdate, sanitizeSummary, SIGNAL_COLUMNS } from "./write";

/** Explicit column list: the refresh role cannot (and must not) read personal_notes / contact_history. */
export const INVESTOR_COLS = `id, firm_name, aliases, entity_type, role_title, partner_name, website_url, stage_preference, sectors, geography,
  fit_rationale, investment_thesis, relationship_status, last_contact_date::text as last_contact_date`;

export const loadInvestor = async (q: Queryable, id: string): Promise<InvestorRow | undefined> =>
  (await q.query<InvestorRow>(`select ${INVESTOR_COLS} from investors where id = $1`, [id])).rows[0];

export interface StoredSignal {
  id: string;
  published_at: string;
  relevance_score: number;
  evidence_confidence: Confidence;
  headline: string;
  summary: string;
  evidence_excerpt: string | null;
  source_name: string | null;
  sector_match: SectorMatch | null;
  new_capital: boolean;
}

export interface Scored {
  result: ScoreResult;
  /** The stored row the score was computed from (the "lead signal"). */
  lead: StoredSignal | undefined;
  inWindow: number;
  changed: boolean;
  historyId: number;
}

/**
 * Score one investor from the evidence ALREADY STORED (no network, no model) and write the four signal columns plus a
 * history row. Used by a refresh after it has stored new evidence, and by a re-score that only applies the passage of
 * time or a rule change. `q` must run as the restricted refresh role.
 */
export async function scoreAndWrite(q: Queryable, inv: InvestorRow, o: { now: Date; partial: boolean; runId: string | null; source: "refresh" | "rescore" }): Promise<Scored> {
  // Everything verified and not a duplicate, across all runs — evidence persists until it ages out.
  const stored = (await q.query<StoredSignal>(
    `select id, published_at::text as published_at, relevance_score, evidence_confidence, headline, summary, evidence_excerpt, source_name, sector_match, new_capital
       from signals where investor_id = $1 and verification_status = 'verified' and duplicate_of is null and published_at is not null`,
    [inv.id],
  )).rows;

  const inWindow = stored.filter((s) => { const a = ageInDays(s.published_at, o.now); return a >= -1 && a <= 30; });
  const scored: ScoredSignal[] = inWindow.map((s) => ({
    id: s.id, published_at: s.published_at, relevance: s.relevance_score, confidence: s.evidence_confidence, headline: s.summary || s.headline,
    sector_match: s.sector_match, new_capital: s.new_capital, tier: sourceTier(s.source_name, inv.website_url),
  }));
  const result = scoreInvestor({
    now: o.now, signals: scored,
    profile: { stage_preference: inv.stage_preference, sectors: inv.sectors, geography: inv.geography, thesis_text: inv.investment_thesis ?? inv.fit_rationale },
    relationship: { status: inv.relationship_status, last_contact_date: inv.last_contact_date },
    coverage: o.partial ? "partial" : "complete",
  });

  const relevantEver = stored.filter((s) => effectiveRelevance({ relevance: s.relevance_score, sector_match: s.sector_match } as ScoredSignal) >= RELEVANCE_MIN).map((s) => s.published_at).sort();
  const lastSignalDate = relevantEver.at(-1) ?? null;
  const lead = stored.find((s) => s.id === result.lead_signal?.id);
  let summary: string;
  if (lead) summary = lead.summary + (result.relevant_signal_count > 1 ? ` (+${result.relevant_signal_count - 1} more relevant signal${result.relevant_signal_count > 2 ? "s" : ""})` : "");
  else if (inWindow.length) summary = `${inWindow.length} verified signal${inWindow.length > 1 ? "s" : ""} in the last 30 days, none relevant to ${STARTUP.sector}.`;
  else summary = lastSignalDate ? `No relevant signal in the last 30 days (most recent: ${lastSignalDate}).` : "No verified signal in the last 30 days.";
  if (!lead && o.partial) summary += " Some sources failed, so this is not conclusive.";

  const changed = await applySignalUpdate(q, inv.id, {
    last_signal_date: lastSignalDate,
    signal_summary: sanitizeSummary(summary),
    follow_up_score: result.score,
    recommended_action: result.action,
  });

  const historyId = (await q.query<{ id: number }>(
    `insert into score_history (investor_id, source, run_id, score, action, explanation, breakdown, lead_signal_id, capped_by)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb) returning id::int as id`,
    [inv.id, o.source, o.runId, result.score, result.action, result.explanation, JSON.stringify(result.breakdown), result.lead_signal?.id ?? null, JSON.stringify(result.capped_by)],
  )).rows[0]!.id;

  return { result, lead, inWindow: inWindow.length, changed, historyId };
}

/** The most recent angle written for this investor, and which signal it was written from. */
export async function previousAngle(q: Queryable, investorId: string, excludeHistoryId: number): Promise<{ angle: string | null; lead: string | null } | undefined> {
  return (await q.query<{ angle: string | null; lead: string | null }>(
    `select angle, lead_signal_id::text as lead from score_history where investor_id = $1 and id <> $2 and angle is not null order by at desc, id desc limit 1`,
    [investorId, excludeHistoryId],
  )).rows[0];
}

export interface RescoreSummary {
  investors: number;
  changed: number;
  action_changes: number;
  angles: number;
  skipped: number;
}

/**
 * Re-score investors from stored evidence, without searching. Two reasons to do it:
 *   1. Time passes. Recency decays daily, but a refresh only re-scores the investors it searched (investors checked
 *      recently or "cold" are skipped to save search credits), so without this their scores would go stale.
 *   2. A scoring rule changed. Evidence is unchanged; only the arithmetic is.
 * It writes exactly the four signal columns, through the same allowlist and role as a refresh. Investors that were
 * never successfully checked are left alone: scoring them would turn "never looked" into a number.
 */
export async function rescoreAll(rdb: Db, now: Date, opts: { ai?: AiClient; only?: Set<string>; skip?: Set<string> } = {}): Promise<RescoreSummary> {
  const ids = (await rdb.query<{ id: string }>(
    `select i.id from investors i where exists (select 1 from run_items r where r.investor_id = i.id and r.status = 'done') order by i.firm_name`,
  )).rows.map((r) => r.id);
  const sum: RescoreSummary = { investors: 0, changed: 0, action_changes: 0, angles: 0, skipped: 0 };

  for (const id of ids) {
    if ((opts.only && !opts.only.has(id)) || opts.skip?.has(id)) { sum.skipped++; continue; }
    try {
      const out = await rdb.tx(async (q) => {
        const inv = await loadInvestor(q, id);
        if (!inv) return null;
        const prev = (await q.query<{ a: string | null }>(`select recommended_action as a from investors where id = $1`, [id])).rows[0]?.a ?? null;
        const partial = (await q.query<{ c: string | null }>(
          `select outcome->>'coverage' as c from run_items where investor_id = $1 and status = 'done' order by finished_at desc nulls last limit 1`, [id],
        )).rows[0]?.c === "partial";
        const sc = await scoreAndWrite(q, inv, { now, partial, runId: null, source: "rescore" });
        // Carry the existing angle forward while the lead signal is unchanged (no repeat model call).
        let angle: string | null = null;
        if (sc.result.action === "reach_out_now" && sc.lead) {
          const p = await previousAngle(q, id, sc.historyId);
          if (p?.angle && p.lead === sc.lead.id) {
            angle = p.angle;
            await q.query(`update score_history set angle = $2 where id = $1`, [sc.historyId, angle]);
          }
        }
        return { sc, prev, angle, firm: inv.firm_name };
      });
      if (!out) continue;
      sum.investors++;
      if (out.sc.changed) sum.changed++;
      if (out.prev !== out.sc.result.action) sum.action_changes++;
      if (opts.ai && out.sc.result.action === "reach_out_now" && out.sc.lead && !out.angle) {
        const l = out.sc.lead;
        const angle = await generateAngle(opts.ai, out.firm, { headline: l.headline, summary: l.summary, excerpt: l.evidence_excerpt, published_at: l.published_at });
        if (angle) { await rdb.query(`update score_history set angle = $2 where id = $1`, [out.sc.historyId, angle]); sum.angles++; }
      }
    } catch (e) {
      await rdb.query(`insert into audit_logs (investor_id, level, event, detail) values ($1, 'error', 'rescore_failed', $2::jsonb)`, [id, JSON.stringify({ message: String((e as Error).message ?? e).slice(0, 200) })]);
    }
  }
  await rdb.query(`insert into audit_logs (event, detail) values ('rescore', $1::jsonb)`, [JSON.stringify({ ...sum, fields: SIGNAL_COLUMNS })]);
  return sum;
}
