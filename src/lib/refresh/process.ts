import { createHash } from "node:crypto";
import { analyzeCandidates, type Verdict } from "@/lib/ai/analyze";
import { generateAngle, type AngleEvidence } from "@/lib/ai/angle";
import { pickDisplayHeadline, reviewSignals, type ReviewInput } from "@/lib/ai/review";
import type { Db, Queryable } from "@/lib/db";
import { RELEVANCE_MIN, type Confidence, type SectorMatch } from "@/lib/scoring/score";
import { checkPortfolio, portfolioDue, storePortfolio } from "./portfolio";
import { reviewInvestorSignals } from "./review";
import { previousAngle, scoreAndWrite } from "./rescore";
import { research, type CoverageEntry, type Deps, type InvestorRow, type ResearchCandidate, type Rejected } from "./research";
import { sanitizeSummary, SIGNAL_COLUMNS } from "./write";

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
  published_at: string | null; date_source: "page" | "search_estimate" | "post_id" | "feed" | null;
  signal_type: string | null; evidence_excerpt: string | null; summary: string | null; relevance_explanation: string | null;
  relevance_score: number | null; evidence_confidence: Confidence | null;
  verification_status: "verified" | "needs_review" | "rejected"; rejection_reason: string | null;
  content_hash: string | null; duplicate_of_url?: string; new_capital: boolean;
  /** Judged from the snippet only because the page fetch failed transiently; re-judged next run. */
  provisional: boolean;
  /** Second-pass review (null = not reviewed). */
  sector_match: SectorMatch | null; firm_acting: boolean | null; display_headline: string | null; review_note: string | null; reviewed: boolean;
}

const UNREVIEWED = { provisional: false, sector_match: null, firm_acting: null, display_headline: null, review_note: null, reviewed: false } as const;

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
        verification_status: "verified", rejection_reason: null, new_capital: a.new_capital, ...UNREVIEWED, provisional: !!c.provisional,
      };
    }
    return {
      ...base, signal_type: null, evidence_excerpt: null, summary: null, relevance_explanation: null,
      relevance_score: v.assessment?.relevance ?? null, evidence_confidence: null,
      verification_status: v.status, rejection_reason: v.reason, new_capital: false, ...UNREVIEWED,
    };
  });
}

// A candidate rejected only because its page could not be read is kept as "needs review" (not a final "rejected"), so the
// next refresh looks at it again instead of treating a transient outage as a verdict.
const rejectedRow = (r: Rejected): SignalRow => ({
  url: r.url, canonical_url: r.canonical_url, headline: r.title.slice(0, 300), source_name: r.source_name, published_at: r.published_at,
  date_source: null, signal_type: null, evidence_excerpt: null, summary: null, relevance_explanation: null, relevance_score: null,
  evidence_confidence: null, verification_status: r.transient ? "needs_review" : "rejected", rejection_reason: r.reason, content_hash: null, duplicate_of_url: r.duplicate_of_url, new_capital: false, ...UNREVIEWED,
});

async function upsertSignal(q: Queryable, runId: string, investorId: string, s: SignalRow): Promise<string | null> {
  const { rows } = await q.query<{ id: string }>(
    `insert into signals (investor_id, run_id, url, canonical_url, headline, source_name, published_at, date_basis, date_source,
        signal_type, evidence_excerpt, summary, relevance_explanation, relevance_score, evidence_confidence,
        verification_status, rejection_reason, content_hash, new_capital, sector_match, firm_acting, display_headline, review_note, reviewed_at, provisional)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,case when $24 then now() end,$25)
     on conflict (investor_id, canonical_url) do update set
        run_id = excluded.run_id, headline = excluded.headline, published_at = excluded.published_at,
        date_basis = excluded.date_basis, date_source = excluded.date_source, signal_type = excluded.signal_type,
        evidence_excerpt = excluded.evidence_excerpt, summary = excluded.summary,
        relevance_explanation = excluded.relevance_explanation, relevance_score = excluded.relevance_score,
        evidence_confidence = excluded.evidence_confidence, verification_status = excluded.verification_status,
        rejection_reason = excluded.rejection_reason, content_hash = excluded.content_hash, new_capital = excluded.new_capital,
        sector_match = excluded.sector_match, firm_acting = excluded.firm_acting, display_headline = excluded.display_headline,
        review_note = excluded.review_note, reviewed_at = excluded.reviewed_at, provisional = excluded.provisional, retrieved_at = now()
      -- a settled verdict is never overwritten; only unresolved items, cap-dropped ones and provisional ones are reconsidered
      where signals.verification_status = 'needs_review' or signals.rejection_reason = 'over_candidate_cap' or signals.provisional
     returning id`,
    [
      investorId, runId, s.url, s.canonical_url, s.headline, s.source_name, s.published_at, s.published_at ? "published" : "unknown",
      s.date_source, s.signal_type, s.evidence_excerpt, s.summary, s.relevance_explanation, s.relevance_score, s.evidence_confidence,
      s.verification_status, s.rejection_reason, s.content_hash, s.new_capital, s.sector_match, s.firm_acting, s.display_headline, s.review_note, s.reviewed, s.provisional,
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
          and coalesce(rejection_reason, '') <> 'over_candidate_cap' and not provisional`,
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

  // Second pass: only for evidence that is verified AND relevant enough to influence a score. A failure here never fails
  // the investor: the signals simply stay "not reviewed", which the scoring rules treat conservatively.
  const reviewable = signalRows.flatMap((s, i) => (s.verification_status === "verified" && (s.relevance_score ?? 0) >= RELEVANCE_MIN ? [{ s, c: res.candidates[i]! }] : []));
  const reviewAttempted = reviewable.length > 0;
  if (reviewable.length) {
    const inputs: ReviewInput[] = reviewable.map(({ s, c }) => ({ index: c.index, title: s.headline, summary: s.summary, excerpt: s.evidence_excerpt, source: s.source_name, published_at: s.published_at! }));
    const rv = await reviewSignals(deps.ai, inv, inputs);
    counters.ai_calls += rv.ai_calls;
    counters.sources_checked += rv.ai_calls;
    if (rv.ok) {
      const byIndex = new Map(rv.verdicts.map((v) => [v.index, v]));
      let notActing = 0;
      for (const { s, c } of reviewable) {
        const v = byIndex.get(c.index);
        if (!v) continue;
        s.reviewed = true;
        s.sector_match = v.sector_match;
        s.firm_acting = v.firm_acting;
        s.review_note = v.note ? sanitizeSummary(v.note, 300) : null;
        s.display_headline = pickDisplayHeadline(s.headline, v.clean_headline, inv);
        if (!v.firm_acting) { s.verification_status = "rejected"; s.rejection_reason = "second_pass_not_acting"; notActing++; }
      }
      coverage.push({ source: "gemini_review", status: "ok", result_count: rv.verdicts.length, error_category: null, note: notActing ? `${notActing} signal${notActing > 1 ? "s" : ""} rejected: the excerpt did not show this firm acting` : null });
    } else {
      coverage.push({ source: "gemini_review", status: "error", result_count: 0, error_category: rv.category, note: `${rv.message}; signals stay unreviewed (they cannot trigger "reach out now" yet)` });
    }
  } else {
    coverage.push({ source: "gemini_review", status: "skipped", result_count: 0, error_category: null, note: "no new relevant signal to review" });
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

    const now = deps.now();
    const sc = await scoreAndWrite(q, inv, { now, partial, runId, source: "refresh" });
    const { result, lead } = sc;

    // Reuse the previous opening angle while the lead signal is the same: no repeat AI call, stable wording.
    const prev = await previousAngle(q, inv.id, sc.historyId);
    const reusedAngle = result.action === "reach_out_now" && result.lead_signal?.id && prev?.lead === result.lead_signal.id ? prev.angle : null;
    if (reusedAngle) await q.query(`update score_history set angle = $2 where id = $1`, [sc.historyId, reusedAngle]);

    const rejectedByReason: Record<string, number> = {};
    for (const s of [...signalRows.filter((x) => x.verification_status !== "verified"), ...res.rejected.map(rejectedRow)])
      rejectedByReason[s.rejection_reason ?? "unknown"] = (rejectedByReason[s.rejection_reason ?? "unknown"] ?? 0) + 1;
    const outcome = {
      score: result.score, action: result.action, explanation: result.explanation, breakdown: result.breakdown, capped_by: result.capped_by,
      lead_signal_id: result.lead_signal?.id ?? null, relevant_signals: result.relevant_signal_count,
      accepted_new: accepted.length, skipped_already_assessed: res.skippedKnown, rejected: rejectedByReason,
      coverage: partial ? "partial" : "complete", ai_calls: counters.ai_calls, columns_changed: sc.changed,
    };
    await audit(q, runId, inv.id, "info", "signal_columns_updated", { fields: SIGNAL_COLUMNS, changed: sc.changed, score: result.score, action: result.action, capped_by: result.capped_by });
    await q.query(`update run_items set status = 'done', finished_at = now(), error = null, outcome = $3::jsonb where run_id = $1 and investor_id = $2`, [runId, inv.id, JSON.stringify(outcome)]);
    // A suggested opening angle is worth generating only for the investors we recommend approaching now.
    const angleFor: AngleEvidence | null =
      result.action === "reach_out_now" && lead && !reusedAngle ? { headline: lead.headline, summary: lead.summary, excerpt: lead.evidence_excerpt, published_at: lead.published_at } : null;
    return { changed: sc.changed, angleFor, historyId: sc.historyId };
  });

  if (outcome.angleFor) {
    counters.ai_calls++;
    const angle = await generateAngle(deps.ai, inv.firm_name, outcome.angleFor);
    if (angle) await rdb.query(`update score_history set angle = $2 where id = $1`, [outcome.historyId, angle]);
  }

  // Evidence stored on an earlier run whose second-pass review failed (or pre-dates the review) is retried now; if anything
  // was reviewed the investor is re-scored. Skipped when this run already attempted a review, so a Gemini outage is not retried
  // within seconds.
  let changed = outcome.changed;
  if (!reviewAttempted) {
    const rr = await reviewInvestorSignals(rdb, deps.ai, inv, deps.now());
    counters.ai_calls += rr.ai_calls;
    counters.sources_checked += rr.ai_calls;
    if (rr.reviewed > 0) {
      const sc = await rdb.tx(async (q) => {
        const s2 = await scoreAndWrite(q, inv, { now: deps.now(), partial, runId, source: "refresh" });
        const r = s2.result;
        await q.query(`update run_items set outcome = outcome || $3::jsonb where run_id = $1 and investor_id = $2`, [
          runId, inv.id,
          JSON.stringify({ score: r.score, action: r.action, explanation: r.explanation, breakdown: r.breakdown, capped_by: r.capped_by, lead_signal_id: r.lead_signal?.id ?? null, relevant_signals: r.relevant_signal_count }),
        ]);
        const prev = await previousAngle(q, inv.id, s2.historyId);
        const reuse = r.action === "reach_out_now" && r.lead_signal?.id && prev?.lead === r.lead_signal.id ? prev.angle : null;
        if (reuse) await q.query(`update score_history set angle = $2 where id = $1`, [s2.historyId, reuse]);
        return { s2, needAngle: r.action === "reach_out_now" && !!s2.lead && !reuse };
      });
      changed = changed || sc.s2.changed;
      if (sc.needAngle && sc.s2.lead) {
        counters.ai_calls++;
        const l = sc.s2.lead;
        const angle = await generateAngle(deps.ai, inv.firm_name, { headline: l.headline, summary: l.summary, excerpt: l.evidence_excerpt, published_at: l.published_at });
        if (angle) await rdb.query(`update score_history set angle = $2 where id = $1`, [sc.s2.historyId, angle]);
      }
    }
  }

  // Portfolio check: monthly per investor, from its own site. Best effort: a problem is recorded as coverage and never fails the investor.
  if (deps.portfolio) {
    try {
      if (await portfolioDue(rdb, inv.id, deps.now())) {
        const pr = await checkPortfolio(deps, inv);
        if (pr.kind !== "skip") {
          counters.ai_calls += pr.ai_calls;
          await storePortfolio(rdb, runId, inv.id, pr);
        }
      }
    } catch (e) {
      await audit(rdb, runId, inv.id, "warn", "portfolio_check_failed", { message: String((e as Error).message ?? e).slice(0, 200) }).catch(() => {});
    }
  }

  counters.records_updated = changed ? 1 : 0;
  return { ok: true, retryable: false, counters };
}
