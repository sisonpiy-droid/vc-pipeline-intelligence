import { pickDisplayHeadline, reviewSignals, type ReviewInput } from "@/lib/ai/review";
import type { AiClient } from "@/lib/ai/gemini";
import type { Db } from "@/lib/db";
import { DEFAULT_CONFIG, RELEVANCE_MIN } from "@/lib/scoring/score";
import { windowStart } from "@/lib/signals/window";
import { sanitizeSummary } from "./write";

export interface ReviewSummary {
  investors: number;
  reviewed: number;
  rejected: number;
  failed_investors: number;
  ai_calls: number;
}

interface StoredRow {
  id: string; headline: string; summary: string | null; evidence_excerpt: string | null; source_name: string | null; published_at: string;
}

/**
 * Second-pass review of ONE investor's stored evidence that is verified, still inside the 30-day window, relevant enough to
 * matter, and not yet reviewed. This is how a review that failed earlier (Gemini down at the time) is retried, and how
 * evidence that pre-dates the review gets one. Same rules as for new evidence. One Gemini call, no search credits.
 */
export async function reviewInvestorSignals(
  rdb: Db, ai: AiClient, inv: { id: string; firm_name: string; aliases: string[]; entity_type: string }, now: Date,
): Promise<{ considered: number; reviewed: number; rejected: number; ai_calls: number; failed: boolean }> {
  const rows = (await rdb.query<StoredRow>(
    `select id, headline, summary, evidence_excerpt, source_name, published_at::text as published_at from signals
      where investor_id = $1 and verification_status = 'verified' and duplicate_of is null and reviewed_at is null
        and relevance_score >= ${RELEVANCE_MIN} and published_at >= $2::date order by published_at desc limit 20`,
    [inv.id, windowStart(now)],
  )).rows;
  if (rows.length === 0) return { considered: 0, reviewed: 0, rejected: 0, ai_calls: 0, failed: false };

  const items: ReviewInput[] = rows.map((g, index) => ({ index, title: g.headline, summary: g.summary, excerpt: g.evidence_excerpt, source: g.source_name, published_at: g.published_at }));
  const rv = await reviewSignals(ai, inv, items);
  if (!rv.ok) {
    await rdb.query(`insert into audit_logs (investor_id, level, event, detail) values ($1, 'warn', 'review_failed', $2::jsonb)`, [inv.id, JSON.stringify({ category: rv.category })]);
    return { considered: rows.length, reviewed: 0, rejected: 0, ai_calls: rv.ai_calls, failed: true };
  }
  let rejected = 0;
  await rdb.tx(async (q) => {
    for (const v of rv.verdicts) {
      const g = rows[v.index]!;
      const reject = !v.firm_acting;
      await q.query(
        `update signals set sector_match = $2, firm_acting = $3, display_headline = $4, review_note = $5, reviewed_at = now(),
                verification_status = case when $6 then 'rejected' else verification_status end,
                rejection_reason = case when $6 then 'second_pass_not_acting' else rejection_reason end
          where id = $1`,
        [g.id, v.sector_match, v.firm_acting, pickDisplayHeadline(g.headline, v.clean_headline, inv), v.note ? sanitizeSummary(v.note, 300) : null, reject],
      );
      if (reject) rejected++;
    }
    await q.query(`insert into audit_logs (investor_id, event, detail) values ($1, 'review_stored', $2::jsonb)`, [inv.id, JSON.stringify({ reviewed: rv.verdicts.length, rejected, sector_caps: DEFAULT_CONFIG.sectorCap })]);
  });
  return { considered: rows.length, reviewed: rv.verdicts.length, rejected, ai_calls: rv.ai_calls, failed: false };
}

/** Every investor that has anything to review (the one-off backfill, `npm run rescore -- --review`). */
export async function reviewStored(rdb: Db, ai: AiClient, now: Date): Promise<ReviewSummary> {
  const invs = (await rdb.query<{ id: string; firm_name: string; aliases: string[]; entity_type: string }>(
    `select distinct i.id, i.firm_name, i.aliases, i.entity_type from investors i join signals s on s.investor_id = i.id
      where s.verification_status = 'verified' and s.duplicate_of is null and s.reviewed_at is null and s.relevance_score >= ${RELEVANCE_MIN} and s.published_at >= $1::date
      order by i.firm_name`,
    [windowStart(now)],
  )).rows;
  const sum: ReviewSummary = { investors: 0, reviewed: 0, rejected: 0, failed_investors: 0, ai_calls: 0 };
  for (const inv of invs) {
    const r = await reviewInvestorSignals(rdb, ai, inv, now);
    sum.ai_calls += r.ai_calls;
    if (r.failed) { sum.failed_investors++; continue; }
    sum.investors++;
    sum.reviewed += r.reviewed;
    sum.rejected += r.rejected;
  }
  return sum;
}
