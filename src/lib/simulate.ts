import type { Db } from "@/lib/db";
import { sourceTier } from "@/lib/format";
import { DEFAULT_CONFIG, type ScoreInput, type ScoredSignal, type ScoringConfig } from "@/lib/scoring/score";
import type { Scope } from "@/lib/read";

/**
 * What-if scoring. The server hands the browser each checked investor's STORED evidence and profile; the browser re-runs
 * the very same scoring function (src/lib/scoring/score.ts) with the founder's own weights and thresholds. Nothing here is
 * written anywhere: it answers "who would rise or fall if I cared more about recency / stricter sources / etc.", and the
 * production score, the database and the refresh are unaffected.
 */
export interface SimInvestor {
  id: string;
  firm_name: string;
  entity_type: string;
  stored_score: number | null;
  stored_action: string | null;
  input: Omit<ScoreInput, "now" | "config">;
}

export interface Controls {
  weights: Record<"recency" | "relevance" | "evidence" | "fit" | "relationship", number>;
  reachOutNow: number;
  prepareOutreach: number;
  reachOutMinRelevance: number;
  /** % of full evidence credit a social-media post earns. */
  socialPct: number;
  adjacentCap: number;
  softCap: number; // general seed / B2B-software topics
}

export const DEFAULT_CONTROLS: Controls = {
  weights: { ...DEFAULT_CONFIG.weights },
  reachOutNow: DEFAULT_CONFIG.thresholds.reachOutNow,
  prepareOutreach: DEFAULT_CONFIG.thresholds.prepareOutreach,
  reachOutMinRelevance: DEFAULT_CONFIG.reachOutMinRelevance,
  socialPct: Math.round(DEFAULT_CONFIG.tierFactor.social * 100),
  adjacentCap: DEFAULT_CONFIG.sectorCap.adjacent,
  softCap: DEFAULT_CONFIG.sectorCap.b2b_software,
};

/** Weights are relative: they are rescaled to sum to 100, so the 0-100 scale of the score is preserved. */
export function buildConfig(c: Controls): ScoringConfig {
  const sum = Object.values(c.weights).reduce((a, b) => a + b, 0);
  const k = sum > 0 ? 100 / sum : 1;
  const weights = sum > 0 ? (Object.fromEntries(Object.entries(c.weights).map(([n, v]) => [n, v * k])) as Controls["weights"]) : { ...DEFAULT_CONFIG.weights };
  return {
    weights,
    thresholds: { reachOutNow: c.reachOutNow, prepareOutreach: Math.min(c.prepareOutreach, c.reachOutNow - 1) },
    reachOutMinRelevance: c.reachOutMinRelevance,
    tierFactor: { ...DEFAULT_CONFIG.tierFactor, social: c.socialPct / 100 },
    sectorCap: { ...DEFAULT_CONFIG.sectorCap, adjacent: c.adjacentCap, b2b_software: c.softCap, seed_generalist: c.softCap },
  };
}

/** Named starting points, each a different philosophy about what makes an investor worth emailing today. */
export const PRESETS: { key: string; label: string; help: string; controls: Controls }[] = [
  { key: "default", label: "Production rules", help: "Exactly how the dashboard scores today.", controls: DEFAULT_CONTROLS },
  { key: "fresh", label: "Freshness first", help: "Care most about what happened this week.", controls: { ...DEFAULT_CONTROLS, weights: { recency: 45, relevance: 25, evidence: 15, fit: 10, relationship: 5 } } },
  { key: "proof", label: "Proof first", help: "Trust only strong sources; social posts barely count.", controls: { ...DEFAULT_CONTROLS, weights: { recency: 20, relevance: 25, evidence: 35, fit: 15, relationship: 5 }, socialPct: 20 } },
  { key: "thesis", label: "Thesis fit first", help: "Favour investors whose profile fits a Seed B2B logistics company.", controls: { ...DEFAULT_CONTROLS, weights: { recency: 20, relevance: 25, evidence: 15, fit: 35, relationship: 5 } } },
  { key: "open", label: "Cast a wide net", help: "Lower the bar for 'reach out now' and tolerate adjacent topics.", controls: { ...DEFAULT_CONTROLS, reachOutNow: 65, prepareOutreach: 45, reachOutMinRelevance: 45, adjacentCap: 60, softCap: 75 } },
];

interface Raw {
  id: string; firm_name: string; entity_type: string; website_url: string | null; stage_preference: string | null; sectors: string[]; geography: string | null;
  fit_rationale: string | null; investment_thesis: string | null; relationship_status: ScoreInput["relationship"]["status"]; last_contact_date: string | null;
  follow_up_score: number | null; recommended_action: string | null; coverage: string | null;
  signals: { id: string; published_at: string; relevance: number; confidence: ScoredSignal["confidence"]; headline: string; sector_match: ScoredSignal["sector_match"]; new_capital: boolean; source_name: string | null }[];
}

/** Every investor that has been successfully checked at least once (an unchecked investor has no score to simulate). */
export async function getSimulationInputs(db: Db, demo: Scope = false): Promise<SimInvestor[]> {
  const rows = (await db.query<Raw>(
    `select i.id, i.firm_name, i.entity_type, i.website_url, i.stage_preference, i.sectors, i.geography, i.fit_rationale, i.investment_thesis,
            i.relationship_status, i.last_contact_date::text as last_contact_date, i.follow_up_score, i.recommended_action,
            (select r.outcome->>'coverage' from run_items r where r.investor_id = i.id and r.status = 'done' order by r.finished_at desc nulls last limit 1) as coverage,
            coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'published_at', s.published_at::text, 'relevance', s.relevance_score, 'confidence', s.evidence_confidence,
                                                          'headline', coalesce(nullif(s.summary, ''), s.headline), 'sector_match', s.sector_match, 'new_capital', s.new_capital, 'source_name', s.source_name))
                        from signals s where s.investor_id = i.id and s.verification_status = 'verified' and s.duplicate_of is null and s.published_at is not null), '[]'::jsonb) as signals
       from investors i
      where ($1::text = 'all' or i.is_demo = ($1::text = 'demo')) and exists (select 1 from run_items r where r.investor_id = i.id and r.status = 'done')
      order by i.firm_name`, [demo === "all" ? "all" : demo ? "demo" : "real"],
  )).rows;
  return rows.map((r): SimInvestor => ({
    id: r.id, firm_name: r.firm_name, entity_type: r.entity_type, stored_score: r.follow_up_score, stored_action: r.recommended_action,
    input: {
      signals: r.signals.map((s): ScoredSignal => ({ id: s.id, published_at: s.published_at, relevance: s.relevance, confidence: s.confidence, headline: s.headline, sector_match: s.sector_match, new_capital: s.new_capital, tier: sourceTier(s.source_name, r.website_url) })),
      profile: { stage_preference: r.stage_preference, sectors: r.sectors, geography: r.geography, thesis_text: r.investment_thesis ?? r.fit_rationale },
      relationship: { status: r.relationship_status, last_contact_date: r.last_contact_date },
      coverage: r.coverage === "partial" ? "partial" : "complete",
    },
  }));
}
