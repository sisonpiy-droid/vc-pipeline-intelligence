import type { AiClient } from "@/lib/ai/gemini";
import type { Db } from "@/lib/db";
import { sourceTier } from "@/lib/format";
import { scoreInvestor, type Confidence, type ScoredSignal, type SectorMatch } from "@/lib/scoring/score";
import { ageInDays, isoDay } from "@/lib/signals/window";
import { INVESTOR_COLS } from "@/lib/refresh/rescore";
import type { InvestorRow } from "@/lib/refresh/research";
import { judgeSignals, type JudgeItem } from "./judge";
import { rubricToConfig } from "./rubric";
import { profileOf, setStep, type StartupRow } from "./store";

/**
 * Evaluate a startup against the shared investor list, from evidence that is ALREADY collected: no search is run and no Tavily
 * credit is used. Gemini only judges each stored signal against this startup (cached per signal), then the same deterministic
 * scoring function the main dashboard uses ranks the investors with this startup's rubric. Every step records what it did.
 *
 *   candidates  who is in the pool, and who has actually been searched (an investor never searched is not scored, never "quiet")
 *   evidence    the verified signals from the last 30 days that exist for them
 *   judge       Gemini reads each unjudged signal against this startup (resumable: judged signals are kept)
 *   score       deterministic scoring with the rubric
 */
export interface EvalOptions {
  now?: Date;
  /** Upper bound on Gemini calls in one evaluation (free-tier guard). */
  maxAiCalls?: number;
  budgetMs?: number;
  concurrency?: number;
  /** false = do not ask Gemini or touch the judge step: score from the judgements already stored. */
  judge?: boolean;
}

export interface EvalSummary {
  candidates: number;
  searched: number;
  evidence_signals: number;
  evidence_investors: number;
  judged_now: number;
  unjudged: number;
  ai_calls: number;
  scored: number;
  judge_error: string | null;
}

interface SigRow {
  id: string;
  investor_id: string;
  published_at: string;
  headline: string;
  summary: string | null;
  evidence_excerpt: string | null;
  source_name: string | null;
  signal_type: string | null;
  evidence_confidence: Confidence;
  new_capital: boolean;
}

type Inv = InvestorRow & { id: string };

const CHUNK = 20;

export async function evaluateStartup(db: Db, ai: AiClient, startup: StartupRow, o: EvalOptions = {}): Promise<EvalSummary> {
  const now = o.now ?? new Date();
  const maxCalls = o.maxAiCalls ?? 80;
  const deadline = Date.now() + (o.budgetMs ?? 240_000);
  const profile = profileOf(startup);
  const rubric = startup.rubric;
  const sum: EvalSummary = { candidates: 0, searched: 0, evidence_signals: 0, evidence_investors: 0, judged_now: 0, unjudged: 0, ai_calls: 0, scored: 0, judge_error: null };

  // ── candidates ──
  await setStep(db, startup.id, "candidates", "running", null);
  const investors = (await db.query<Inv & { searched: boolean; coverage: string | null }>(
    `select ${INVESTOR_COLS},
            exists (select 1 from run_items r where r.investor_id = i.id and r.status = 'done') as searched,
            (select outcome->>'coverage' from run_items r where r.investor_id = i.id and r.status = 'done' order by finished_at desc nulls last limit 1) as coverage
       from investors i where i.is_demo = false order by i.firm_name`,
  )).rows;
  const searched = investors.filter((i) => i.searched);
  sum.candidates = investors.length;
  sum.searched = searched.length;
  await setStep(db, startup.id, "candidates", "done",
    `${investors.length} investors in the shared list. ${searched.length} have a completed evidence search and will be scored.` +
      (investors.length > searched.length ? ` ${investors.length - searched.length} ${investors.length - searched.length === 1 ? "has" : "have"} not been searched yet: left out, not shown as quiet.` : ""),
    { total: investors.length, searched: searched.length });

  // ── evidence ──
  await setStep(db, startup.id, "evidence", "running", null);
  const all = (await db.query<SigRow>(
    `select s.id, s.investor_id, s.published_at::text as published_at, s.headline, s.summary, s.evidence_excerpt, s.source_name, s.signal_type, s.evidence_confidence, s.new_capital
       from signals s join investors i on i.id = s.investor_id
      where i.is_demo = false and s.verification_status = 'verified' and s.duplicate_of is null and s.published_at is not null
        and s.firm_acting is not false and s.published_at >= $1::date - 40`,
    [isoDay(now)],
  )).rows;
  const searchedIds = new Set(searched.map((i) => i.id));
  const inWindow = all.filter((s) => searchedIds.has(s.investor_id) && ageInDays(s.published_at, now) >= -1 && ageInDays(s.published_at, now) <= 30);
  sum.evidence_signals = inWindow.length;
  sum.evidence_investors = new Set(inWindow.map((s) => s.investor_id)).size;
  await setStep(db, startup.id, "evidence", "done",
    `${inWindow.length} verified signals from the last 30 days, covering ${sum.evidence_investors} investors. They were collected by the shared investor-activity search (each investor's own recent actions), which does not depend on any one startup's sector. No new search was run.`,
    { signals: inWindow.length, investors: sum.evidence_investors });

  // ── judge ──
  const reviews = new Map<string, { relevance: number; sector_match: SectorMatch }>();
  for (const r of (await db.query<{ signal_id: string; relevance: number; sector_match: SectorMatch }>(`select signal_id, relevance, sector_match from startup_signal_reviews where startup_id = $1`, [startup.id])).rows)
    reviews.set(r.signal_id, r);
  const todo = new Map<string, SigRow[]>();
  for (const s of inWindow) if (!reviews.has(s.id)) todo.set(s.investor_id, [...(todo.get(s.investor_id) ?? []), s]);
  const todoCount = [...todo.values()].reduce((n, l) => n + l.length, 0);

  if (o.judge === false) {
    // re-score only: the judge step keeps its last result
  } else if (todoCount === 0) {
    await setStep(db, startup.id, "judge", "done", inWindow.length ? `All ${inWindow.length} signals were already judged for this startup; nothing to ask Gemini.` : "No signals to judge.", { calls: 0, judged: 0 });
  } else {
    await setStep(db, startup.id, "judge", "running", `Gemini is reading ${todoCount} signals against ${profile.name}…`, { total: todoCount });
    const byId = new Map(investors.map((i) => [i.id, i]));
    const queue = [...todo.entries()].flatMap(([id, list]) => { const out: [string, SigRow[]][] = []; for (let k = 0; k < list.length; k += CHUNK) out.push([id, list.slice(k, k + CHUNK)]); return out; });
    let stop = false;
    const worker = async () => {
      for (;;) {
        if (stop || Date.now() > deadline || sum.ai_calls >= maxCalls) return;
        const next = queue.shift();
        if (!next) return;
        const [invId, list] = next;
        const inv = byId.get(invId)!;
        const items: JudgeItem[] = list.map((s, index) => ({ index, title: s.headline, summary: s.summary, excerpt: s.evidence_excerpt, published_at: s.published_at, signal_type: s.signal_type }));
        sum.ai_calls++;
        const res = await judgeSignals(ai, profile, rubric, { firm_name: inv.firm_name, entity_type: inv.entity_type }, items);
        if (!res.ok) {
          sum.ai_calls += res.ai_calls - 1;
          sum.judge_error = res.category;
          if (res.category === "rate_limited" || res.category === "no_credentials" || res.category === "blocked" || res.category === "bad_request") stop = true;
          continue;
        }
        sum.ai_calls += res.ai_calls - 1;
        for (const j of res.judgements) {
          const sig = list[j.index]!;
          await db.query(
            `insert into startup_signal_reviews (startup_id, signal_id, relevance, sector_match, note) values ($1, $2, $3, $4, $5)
             on conflict (startup_id, signal_id) do update set relevance = excluded.relevance, sector_match = excluded.sector_match, note = excluded.note, reviewed_at = now()`,
            [startup.id, sig.id, j.relevance, j.sector_match, j.note],
          );
          reviews.set(sig.id, { relevance: j.relevance, sector_match: j.sector_match });
          sum.judged_now++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 2) }, worker));
    sum.unjudged = inWindow.filter((s) => !reviews.has(s.id)).length;
    const detail = `Gemini judged ${sum.judged_now} of ${todoCount} signals in ${sum.ai_calls} call${sum.ai_calls === 1 ? "" : "s"}.` +
      (sum.unjudged ? ` ${sum.unjudged} could not be judged${sum.judge_error ? ` (${sum.judge_error.replace(/_/g, " ")})` : ""}: they are left out of the scores, and the investors they belong to are marked as not conclusive. Run the evaluation again to finish them.` : "");
    await setStep(db, startup.id, "judge", sum.unjudged ? (sum.judged_now ? "partial" : "failed") : "done", detail, { calls: sum.ai_calls, judged: sum.judged_now, unjudged: sum.unjudged });
  }
  sum.unjudged = inWindow.filter((s) => !reviews.has(s.id)).length;

  // ── score ──
  await setStep(db, startup.id, "score", "running", null);
  const cfg = rubricToConfig(rubric);
  const byInvestor = new Map<string, SigRow[]>();
  for (const s of inWindow) byInvestor.set(s.investor_id, [...(byInvestor.get(s.investor_id) ?? []), s]);
  await db.query(`delete from startup_scores where startup_id = $1`, [startup.id]);
  for (const inv of searched) {
    const sigs = byInvestor.get(inv.id) ?? [];
    const judged = sigs.filter((s) => reviews.has(s.id));
    const scored: ScoredSignal[] = judged.map((s) => {
      const r = reviews.get(s.id)!;
      return { id: s.id, published_at: s.published_at, relevance: r.relevance, sector_match: r.sector_match, confidence: s.evidence_confidence, headline: s.summary || s.headline, new_capital: s.new_capital, tier: sourceTier(s.source_name, inv.website_url) };
    });
    const unjudged = sigs.length - judged.length;
    const partial = inv.coverage === "partial" || unjudged > 0;
    const result = scoreInvestor({
      now, signals: scored, config: cfg, coverage: partial ? "partial" : "complete",
      profile: { stage_preference: inv.stage_preference, sectors: inv.sectors, geography: inv.geography, thesis_text: inv.investment_thesis ?? inv.fit_rationale },
      relationship: { status: "not_contacted", last_contact_date: null }, // another startup has no history with anyone; the founder's own notes are never read here
    });
    const note = unjudged > 0 ? `${unjudged} signal${unjudged === 1 ? " has" : "s have"} not been judged for this startup yet, so this score may be too low.` : null;
    await db.query(
      `insert into startup_scores (startup_id, investor_id, score, action, explanation, breakdown, capped_by, lead_signal_id, evidence_count, coverage, note)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)`,
      [startup.id, inv.id, result.score, result.action, result.explanation, JSON.stringify(result.breakdown), JSON.stringify(result.capped_by), result.lead_signal?.id ?? null, sigs.length, partial ? "partial" : "complete", note],
    );
    sum.scored++;
  }
  const counts = (await db.query<{ action: string; n: number }>(`select action, count(*)::int as n from startup_scores where startup_id = $1 group by action`, [startup.id])).rows;
  await setStep(db, startup.id, "score", sum.unjudged ? "partial" : "done",
    `Scored ${sum.scored} investors with this startup's rubric: ${counts.find((c) => c.action === "reach_out_now")?.n ?? 0} reach out now, ${counts.find((c) => c.action === "prepare_targeted_outreach")?.n ?? 0} prepare outreach.` +
      (sum.unjudged ? ` ${sum.unjudged} signals were not judged yet, so some scores are not conclusive.` : ""),
    { scored: sum.scored, by_action: Object.fromEntries(counts.map((c) => [c.action, c.n])) });
  return sum;
}

/** Re-score from the cached judgements (no Gemini call): used after the rubric's numbers are edited. */
export async function rescoreStartup(db: Db, startup: StartupRow, now = new Date()): Promise<EvalSummary> {
  const noAi = { generateJson: () => Promise.reject(new Error("no model call in a re-score")) };
  return evaluateStartup(db, noAi, startup, { now, maxAiCalls: 0, judge: false });
}
