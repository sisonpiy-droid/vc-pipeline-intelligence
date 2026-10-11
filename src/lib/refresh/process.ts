import { createHash } from "node:crypto";
import { analyzeCandidates, type Verdict } from "@/lib/ai/analyze";
import type { Db, Queryable } from "@/lib/db";
import { RELEVANCE_MIN, scoreInvestor, STARTUP, type Confidence, type ScoredSignal } from "@/lib/scoring/score";
import { ageInDays } from "@/lib/signals/window";
import { research, type CoverageEntry, type Deps, type InvestorRow, type ResearchCandidate, type Rejected } from "./research";
import { applySignalUpdate, sanitizeSummary, SIGNAL_COLUMNS } from "./write";

export interface Counters {
  sources_checked: number;
  signals_discovered: number;
  signals_accepted: number;
  duplicates_removed: number;
  records_updated: number;
  ai_calls: number;
  /** Metered search-provider calls made (the free-tier credit cost). */
  search_calls: number;
}
export const zeroCounters = (): Counters => ({ sources_checked: 0, signals_discovered: 0, signals_accepted: 0, duplicates_removed: 0, records_updated: 0, ai_calls: 0, search_calls: 0 });

export interface ItemResult {
  ok: boolean;
  retryable: boolean;
  error?: string;
  counters: Counters;
}

const RETRYABLE = new Set(["rate_limited", "timeout", "http_5xx", "malformed", "unavailable", "invalid_output"]);
const capConfidence = (c: Confidence, capped: boolean): Confidence => (capped && c === "high" ? "medium" : c);

interface SignalRow {
  url: string; canonical_url: string; headline: string; source_name: string | null;
  published_at: string | null; date_source: "page" | "search_estimate" | "post_id" | null;
  signal_type: string | null; evidence_excerpt: string | null; summary: string | null; relevance_explanation: string | null;
  relevance_score: number | null; evidence_confidence: Confidence | null;
  verification_status: "verified" | "needs_review" | "rejected"; rejection_reason: string | null;
  content_hash: string | null; duplicate_of_url?: string; new_capital: boolean;
}

function rowsFromVerdicts(cands: ResearchCandidate[], verdicts: Verdict[]): SignalRow[] {
  const byIndex = new Map(verdicts.map((v) => [v.index, v]));
  return cands.map((c): SignalRow => {
    const v = byIndex.get(c.index)!;
    const base = {
      url: c.url, canonical_url: c.canonical_url, headline: c.title.slice(0, 300), source_name: c.source_name,
      published_at: c.published_at, date_source: c.date_source, content_hash: createHash("sha256").update(c.text).digest("hex"),
    };
    if (v.status === "verified") {
      const a = v.assessment;
      return {
        ...base, signal_type: a.signal_type, evidence_excerpt: a.evidence_excerpt,
        summary: sanitizeSummary(a.summary, 300), relevance_explanation: sanitizeSummary(a.why_it_matters, 450),
        relevance_score: a.relevance, evidence_confidence: capConfidence(a.confidence, !c.fetched || c.date_source === "search_estimate"),
        verification_status: "verified", rejection_reason: null, new_capital: a.new_capital,
      };
    }
    return {
      ...base, signal_type: null, evidence_excerpt: null, summary: null, relevance_explanation: null,
      relevance_score: v.assessment?.relevance ?? null, evidence_confidence: null,
      verification_status: v.status, rejection_reason: v.reason, new_capital: false,
    };
  });
}

const rejectedRow = (r: Rejected): SignalRow => ({
  url: r.url, canonical_url: r.canonical_url, headline: r.title.slice(0, 300), source_name: r.source_name, published_at: r.published_at,
  date_source: null, signal_type: null, evidence_excerpt: null, summary: null, relevance_explanation: null, relevance_score: null,
  evidence_confidence: null, verification_status: "rejected", rejection_reason: r.reason, content_hash: null, duplicate_of_url: r.duplicate_of_url, new_capital: false,
});

async function upsertSignal(q: Queryable, runId: string, investorId: string, s: SignalRow): Promise<string | null> {
  const { rows } = await q.query<{ id: string }>(
    `insert into signals (investor_id, run_id, url, canonical_url, headline, source_name, published_at, date_basis, date_source,
        signal_type, evidence_excerpt, summary, relevance_explanation, relevance_score, evidence_confidence,
        verification_status, rejection_reason, content_hash, new_capital)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     on conflict (investor_id, canonical_url) do update set
        run_id = excluded.run_id, headline = excluded.headline, published_at = excluded.published_at,
        date_basis = excluded.date_basis, date_source = excluded.date_source, signal_type = excluded.signal_type,
        evidence_excerpt = excluded.evidence_excerpt, summary = excluded.summary,
        relevance_explanation = excluded.relevance_explanation, relevance_score = excluded.relevance_score,
        evidence_confidence = excluded.evidence_confidence, verification_status = excluded.verification_status,
        rejection_reason = excluded.rejection_reason, content_hash = excluded.content_hash, new_capital = excluded.new_capital, retrieved_at = now()
      -- a settled verdict is never overwritten; only unresolved items and cap-dropped ones are reconsidered
      where signals.verification_status = 'needs_review' or signals.rejection_reason = 'over_candidate_cap'
     returning id`,
    [
      investorId, runId, s.url, s.canonical_url, s.headline, s.source_name, s.published_at, s.published_at ? "published" : "unknown",
      s.date_source, s.signal_type, s.evidence_excerpt, s.summary, s.relevance_explanation, s.relevance_score, s.evidence_confidence,
      s.verification_status, s.rejection_reason, s.content_hash, s.new_capital,
    ],
  );
  return rows[0]?.id ?? null;
}

async function upsertCoverage(q: Queryable, runId: string, investorId: string, c: CoverageEntry) {
  await q.query(
    `insert into source_coverage (investor_id, source, run_id, checked_at, status, result_count, error_category, note)
     values ($1,$2,$3,now(),$4,$5,$6,$7)
     on conflict (investor_id, source) do update set run_id = excluded.run_id, checked_at = now(), status = excluded.status,
        result_count = excluded.result_count, error_category = excluded.error_category, note = excluded.note`,
    [investorId, c.source, runId, c.status, c.result_count, c.error_category, c.note],
  );
}

const audit = (q: Queryable, runId: string, investorId: string, level: "info" | "warn" | "error", event: string, detail: object) =>
  q.query(`insert into audit_logs (run_id, investor_id, level, event, detail) values ($1,$2,$3,$4,$5::jsonb)`, [runId, investorId, level, event, JSON.stringify(detail)]);

/**
 * One investor, end to end: research → Gemini analysis → persist evidence → deterministic score → write
 * the four signal columns. `rdb` MUST be the restricted refresh-role Db (asRefresh), and the final
 * persistence happens in a single transaction: either everything for this investor lands, or nothing.
 *
 * The four investor columns are written ONLY when retrieval and analysis both completed. A failed
 * search or an AI outage records the failure (coverage, audit, needs_review evidence) and leaves the
 * previous score untouched — a failure is never turned into "this investor is quiet".
 */
export async function processInvestor(rdb: Db, deps: Deps, runId: string, inv: InvestorRow): Promise<ItemResult> {
  const counters = zeroCounters();
  const known = new Set(
    (await rdb.query<{ canonical_url: string }>(
      `select canonical_url from signals where investor_id = $1 and verification_status in ('verified','rejected')
          and coalesce(rejection_reason, '') <> 'over_candidate_cap'`,
      [inv.id],
    )).rows.map((r) => r.canonical_url),
  );

  const res = await research(deps, inv, known);
  counters.sources_checked += res.sourcesChecked;
  counters.search_calls += res.searchCalls;
  counters.signals_discovered = res.candidates.length + res.rejected.length;
  counters.duplicates_removed = res.rejected.filter((r) => r.reason === "duplicate_event").length;

  if (res.searchFailed) {
    const err = res.searchError!;
    await rdb.tx(async (q) => {
      for (const c of res.coverage) await upsertCoverage(q, runId, inv.id, c);
      await audit(q, runId, inv.id, "error", "search_failed", { category: err.category, message: err.message });
    });
    return { ok: false, retryable: RETRYABLE.has(err.category), error: `search_failed:${err.category}`, counters };
  }

  const analysis = await analyzeCandidates(deps.ai, inv, res.candidates);
  counters.ai_calls = analysis.ai_calls;
  counters.sources_checked += analysis.ai_calls;
  const coverage: CoverageEntry[] = [
    ...res.coverage,
    analysis.ai_error
      ? { source: "gemini_analysis", status: "error", result_count: 0, error_category: analysis.ai_error.category, note: analysis.ai_error.message }
      : { source: "gemini_analysis", status: res.candidates.length ? "ok" : "skipped", result_count: res.candidates.length, error_category: null, note: res.candidates.length ? null : "no candidates to analyse" },
  ];

  const signalRows = rowsFromVerdicts(res.candidates, analysis.verdicts);

  if (analysis.ai_error) {
    await rdb.tx(async (q) => {
      for (const s of signalRows) await upsertSignal(q, runId, inv.id, s); // evidence kept as needs_review
      for (const c of coverage) await upsertCoverage(q, runId, inv.id, c);
      await audit(q, runId, inv.id, "error", "ai_failed", { category: analysis.ai_error!.category, candidates: res.candidates.length });
    });
    return { ok: false, retryable: RETRYABLE.has(analysis.ai_error.category), error: `ai_failed:${analysis.ai_error.category}`, counters };
  }

  const accepted = signalRows.filter((s) => s.verification_status === "verified");
  counters.signals_accepted = accepted.length;
  const partial = res.incompleteSources > 0;

  const outcome = await rdb.tx(async (q) => {
    const idByUrl = new Map<string, string>();
    for (const s of signalRows) {
      const id = await upsertSignal(q, runId, inv.id, s);
      if (id) idByUrl.set(s.canonical_url, id);
    }
    for (const r of res.rejected) {
      const s = rejectedRow(r);
      const id = await upsertSignal(q, runId, inv.id, s);
      if (id && r.duplicate_of_url) {
        const parent = idByUrl.get(r.duplicate_of_url);
        if (parent) await q.query(`update signals set duplicate_of = $2 where id = $1`, [id, parent]);
      }
    }
    for (const c of coverage) await upsertCoverage(q, runId, inv.id, c);

    // Everything verified and not a duplicate, across all runs — evidence persists until it ages out.
    const stored = (await q.query<{
      id: string; published_at: string; relevance_score: number; evidence_confidence: Confidence; headline: string; summary: string;
    }>(
      `select id, published_at::text as published_at, relevance_score, evidence_confidence, headline, summary
         from signals where investor_id = $1 and verification_status = 'verified' and duplicate_of is null and published_at is not null`,
      [inv.id],
    )).rows;

    const now = deps.now();
    const inWindow = stored.filter((s) => { const a = ageInDays(s.published_at, now); return a >= -1 && a <= 30; });
    const scored: ScoredSignal[] = inWindow.map((s) => ({ id: s.id, published_at: s.published_at, relevance: s.relevance_score, confidence: s.evidence_confidence, headline: s.summary || s.headline }));
    const result = scoreInvestor({
      now, signals: scored,
      profile: { stage_preference: inv.stage_preference, sectors: inv.sectors, geography: inv.geography, thesis_text: inv.investment_thesis ?? inv.fit_rationale },
      relationship: { status: inv.relationship_status, last_contact_date: inv.last_contact_date },
      coverage: partial ? "partial" : "complete",
    });

    const relevantEver = stored.filter((s) => s.relevance_score >= RELEVANCE_MIN).map((s) => s.published_at).sort();
    const lastSignalDate = relevantEver.at(-1) ?? null;
    const lead = stored.find((s) => s.id === result.lead_signal?.id);
    let summary: string;
    if (lead) summary = lead.summary + (result.relevant_signal_count > 1 ? ` (+${result.relevant_signal_count - 1} more relevant signal${result.relevant_signal_count > 2 ? "s" : ""})` : "");
    else if (inWindow.length) summary = `${inWindow.length} verified signal${inWindow.length > 1 ? "s" : ""} in the last 30 days, none relevant to ${STARTUP.sector}.`;
    else summary = lastSignalDate ? `No relevant signal in the last 30 days (most recent: ${lastSignalDate}).` : "No verified signal in the last 30 days.";
    if (!lead && partial) summary += " Some sources failed, so this is not conclusive.";

    const changed = await applySignalUpdate(q, inv.id, {
      last_signal_date: lastSignalDate,
      signal_summary: sanitizeSummary(summary),
      follow_up_score: result.score,
      recommended_action: result.action,
    });

    const rejectedByReason: Record<string, number> = {};
    for (const s of [...signalRows.filter((x) => x.verification_status !== "verified"), ...res.rejected.map(rejectedRow)])
      rejectedByReason[s.rejection_reason ?? "unknown"] = (rejectedByReason[s.rejection_reason ?? "unknown"] ?? 0) + 1;
    const outcome = {
      score: result.score, action: result.action, explanation: result.explanation, breakdown: result.breakdown,
      lead_signal_id: result.lead_signal?.id ?? null, relevant_signals: result.relevant_signal_count,
      accepted_new: accepted.length, skipped_already_assessed: res.skippedKnown, rejected: rejectedByReason,
      coverage: partial ? "partial" : "complete", ai_calls: analysis.ai_calls, columns_changed: changed,
    };
    await audit(q, runId, inv.id, "info", "signal_columns_updated", { fields: SIGNAL_COLUMNS, changed, score: result.score, action: result.action });
    await q.query(`update run_items set status = 'done', finished_at = now(), error = null, outcome = $3::jsonb where run_id = $1 and investor_id = $2`, [runId, inv.id, JSON.stringify(outcome)]);
    return { changed };
  });

  counters.records_updated = outcome.changed ? 1 : 0;
  return { ok: true, retryable: false, counters };
}
