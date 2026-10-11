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

/**
 * Second-pass review of evidence that is already stored and still inside the 30-day window but was verified before the
 * review existed (or while the model was unavailable). Same rules as a refresh applies to new evidence; `rdb` is the
 * restricted refresh Db. Costs one Gemini call per investor that has anything to review, and no search credits.
 */
export async function reviewStored(rdb: Db, ai: AiClient, now: Date): Promise<ReviewSummary> {
  const rows = (await rdb.query<{
    id: string; investor_id: string; firm_name: string; aliases: string[]; entity_type: string;
    headline: string; summary: string | null; evidence_excerpt: string | null; source_name: string | null; published_at: string;
  }>(
    `select s.id, s.investor_id, i.firm_name, i.aliases, i.entity_type, s.headline, s.summary, s.evidence_excerpt, s.source_name, s.published_at::text as published_at
       from signals s join investors i on i.id = s.investor_id
      where s.verification_status = 'verified' and s.duplicate_of is null and s.reviewed_at is null
        and s.relevance_score >= ${RELEVANCE_MIN} and s.published_at >= $1::date
      order by i.firm_name, s.published_at desc`,
    [windowStart(now)],
  )).rows;

  const byInvestor = new Map<string, typeof rows>();
  for (const r of rows) byInvestor.set(r.investor_id, [...(byInvestor.get(r.investor_id) ?? []), r]);

  const sum: ReviewSummary = { investors: 0, reviewed: 0, rejected: 0, failed_investors: 0, ai_calls: 0 };
  for (const group of byInvestor.values()) {
    const head = group[0]!;
    const items: ReviewInput[] = group.slice(0, 20).map((g, index) => ({ index, title: g.headline, summary: g.summary, excerpt: g.evidence_excerpt, source: g.source_name, published_at: g.published_at }));
    const rv = await reviewSignals(ai, head, items);
    sum.ai_calls += rv.ai_calls;
    if (!rv.ok) {
      sum.failed_investors++;
      await rdb.query(`insert into audit_logs (investor_id, level, event, detail) values ($1, 'warn', 'review_failed', $2::jsonb)`, [head.investor_id, JSON.stringify({ category: rv.category })]);
      continue;
    }
    sum.investors++;
    await rdb.tx(async (q) => {
      for (const v of rv.verdicts) {
        const g = group[v.index]!;
        const reject = !v.firm_acting;
        await q.query(
          `update signals set sector_match = $2, firm_acting = $3, display_headline = $4, review_note = $5, reviewed_at = now(),
                  verification_status = case when $6 then 'rejected' else verification_status end,
                  rejection_reason = case when $6 then 'second_pass_not_acting' else rejection_reason end
            where id = $1`,
          [g.id, v.sector_match, v.firm_acting, pickDisplayHeadline(g.headline, v.clean_headline, head), v.note ? sanitizeSummary(v.note, 300) : null, reject],
        );
        sum.reviewed++;
        if (reject) sum.rejected++;
      }
      await q.query(`insert into audit_logs (investor_id, event, detail) values ($1, 'review_backfill', $2::jsonb)`, [head.investor_id, JSON.stringify({ reviewed: rv.verdicts.length, sector_caps: DEFAULT_CONFIG.sectorCap })]);
    });
  }
  return sum;
}
