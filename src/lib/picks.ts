import type { PipelineRow } from "./read";
import type { SourceTier } from "./scoring/score";

/**
 * "Start here": the few investors worth an email THIS week. Only investors the scoring engine itself recommends
 * approaching now qualify; ties are broken by how good the evidence is (own site and press beat social posts, logistics
 * beats general seed activity), then by freshness. If fewer than MIN qualify, the best "prepare targeted outreach"
 * candidates fill the gap and are labelled as such: the list never pretends a weaker case is a strong one.
 */
export interface Pick {
  row: PipelineRow;
  basis: "reach_out_now" | "prepare_targeted_outreach";
}

const TIER_RANK: Record<SourceTier, number> = { official: 0, press: 1, other: 2, social: 3 };
const holdIt = (r: PipelineRow) => r.recommended_action === "wait_for_response" || r.relationship_status === "passed" || r.relationship_status === "committed";

const byEvidence = (a: PipelineRow, b: PipelineRow) =>
  (b.follow_up_score ?? 0) - (a.follow_up_score ?? 0) ||
  TIER_RANK[a.lead?.tier ?? "other"] - TIER_RANK[b.lead?.tier ?? "other"] ||
  Number(b.lead?.sector_match === "logistics") - Number(a.lead?.sector_match === "logistics") ||
  (b.last_signal_date ?? "").localeCompare(a.last_signal_date ?? "") ||
  a.firm_name.localeCompare(b.firm_name);

export const MAX_PICKS = 5;
export const MIN_PICKS = 3;

export function topPicks(pipeline: PipelineRow[]): Pick[] {
  const live = pipeline.filter((r) => r.state === "active" && !holdIt(r));
  const reach = live.filter((r) => r.recommended_action === "reach_out_now").sort(byEvidence).slice(0, MAX_PICKS);
  const picks: Pick[] = reach.map((row) => ({ row, basis: "reach_out_now" }));
  if (picks.length < MIN_PICKS) {
    const prep = live.filter((r) => r.recommended_action === "prepare_targeted_outreach").sort(byEvidence).slice(0, MIN_PICKS - picks.length);
    picks.push(...prep.map((row): Pick => ({ row, basis: "prepare_targeted_outreach" })));
  }
  return picks;
}
