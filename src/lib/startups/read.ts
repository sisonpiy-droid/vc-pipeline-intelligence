import type { Queryable } from "@/lib/db";
import type { Component } from "@/lib/scoring/score";

export interface ResultRow {
  investor_id: string;
  firm_name: string;
  entity_type: string;
  website_url: string | null;
  score: number;
  action: string;
  explanation: string | null;
  breakdown: Record<"recency" | "relevance" | "evidence" | "fit" | "relationship", Component> | null;
  capped_by: string[];
  evidence_count: number;
  coverage: "complete" | "partial";
  note: string | null;
  lead: {
    headline: string;
    summary: string | null;
    url: string;
    source_name: string | null;
    published_at: string;
    excerpt: string | null;
    relevance: number | null;
    sector_match: string | null;
    review_note: string | null;
  } | null;
}

/** Everything the results table needs for one startup, best score first. One query; no per-row lookups. */
export async function getResults(q: Queryable, startupId: string): Promise<ResultRow[]> {
  const rows = (await q.query<Omit<ResultRow, "lead"> & { l_headline: string | null; l_summary: string | null; l_url: string | null; l_source: string | null; l_date: string | null; l_excerpt: string | null; l_rel: number | null; l_match: string | null; l_note: string | null }>(
    `select x.investor_id, i.firm_name, i.entity_type, i.website_url, x.score, x.action, x.explanation, x.breakdown, x.capped_by, x.evidence_count, x.coverage, x.note,
            s.headline as l_headline, s.summary as l_summary, s.url as l_url, s.source_name as l_source, s.published_at::text as l_date, s.evidence_excerpt as l_excerpt,
            r.relevance as l_rel, r.sector_match as l_match, r.note as l_note
       from startup_scores x
       join investors i on i.id = x.investor_id
       left join signals s on s.id = x.lead_signal_id
       left join startup_signal_reviews r on r.signal_id = x.lead_signal_id and r.startup_id = x.startup_id
      where x.startup_id = $1
      order by x.score desc, i.firm_name`,
    [startupId],
  )).rows;
  return rows.map(({ l_headline, l_summary, l_url, l_source, l_date, l_excerpt, l_rel, l_match, l_note, ...r }) => ({
    ...r,
    lead: l_headline && l_url && l_date ? { headline: l_headline, summary: l_summary, url: l_url, source_name: l_source, published_at: l_date, excerpt: l_excerpt, relevance: l_rel, sector_match: l_match, review_note: l_note } : null,
  }));
}
