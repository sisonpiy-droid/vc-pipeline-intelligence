import { ageInDays } from "@/lib/signals/window";

/**
 * Deterministic follow-up score (0–100). No model is involved in any arithmetic here: Gemini supplies
 * a *relevance judgement* per signal, this file turns judgements + profile + relationship into a number.
 *
 * Weights (starting values from the brief; rationale in docs/SCORING.md):
 *   recency 30 · relevance 30 · evidence 20 · fit 15 · relationship 5
 *
 * Design rules that matter more than the weights:
 *  1. Only a RELEVANT signal (relevance ≥ RELEVANCE_MIN) can earn recency or evidence points, and those
 *     points are scaled by how relevant it is. A fresh, well-sourced, off-topic article earns nothing.
 *  2. With no relevant signal, recency/relevance/evidence are all 0, so the score can never exceed
 *     fit + relationship (≤ 20). Missing data cannot inflate a score.
 *  3. Signal relevance, investor fit, relationship and evidence confidence stay separate in the breakdown.
 */

export const WEIGHTS = { recency: 30, relevance: 30, evidence: 20, fit: 15, relationship: 5 } as const;
export const REACH_OUT_MIN_RELEVANCE = 60; // the lead signal must be at least this relevant before a cold approach is recommended
export const RELEVANCE_MIN = 40; // below this a signal is genuine but not about the founder's market
export const FULL_RELEVANCE = 70; // at/above this, recency and evidence count in full
// Chosen from the score grid in docs/SCORING.md: 75 needs a fresh signal that is clearly relevant (≳ 60) from a
// well-fitting investor; a merely adjacent signal (relevance ~55) lands in "prepare targeted outreach" instead.
export const ACTION_THRESHOLDS = { reachOutNow: 75, prepareOutreach: 55 } as const;

/** The founder's company, which fit and relevance are judged against. Assumptions are shown in the UI. */
export const STARTUP = {
  description: "B2B logistics SaaS, raising a Seed round",
  stage: "seed",
  sector: "B2B logistics / supply-chain SaaS",
  // The brief does not state the founder's geography; the dataset is India-focused, so India is assumed.
  geography: "India",
} as const;

export type Confidence = "high" | "medium" | "low";
export type Action = "reach_out_now" | "prepare_targeted_outreach" | "wait_for_response" | "research_further" | "no_action";
export type RelationshipStatus =
  | "not_contacted" | "contacted" | "in_conversation" | "awaiting_response" | "passed" | "committed";

/** How close a signal's topic is to the founder's market. Judged by Gemini in a second pass; it only ever LOWERS a score. */
export type SectorMatch = "logistics" | "b2b_software" | "seed_generalist" | "adjacent" | "unrelated";
/** Where the evidence appeared: the investor's own site, recognised press, a social post, or anything else. */
export type SourceTier = "official" | "press" | "social" | "other";

export interface ScoredSignal {
  id?: string;
  published_at: string; // YYYY-MM-DD, already validated as in-window by the caller (re-checked here)
  relevance: number; // 0–100, model judgement of relevance to STARTUP
  confidence: Confidence; // evidence quality
  headline?: string;
  /** Second-pass topic judgement. Missing = not reviewed yet: it can still rank, but cannot trigger "reach out now". */
  sector_match?: SectorMatch | null;
  tier?: SourceTier;
  /** The investor announced a new fund / close / bigger cheque ceiling. */
  new_capital?: boolean;
}

/** Everything tunable. The production score uses DEFAULT_CONFIG; the what-if page passes its own (never stored). */
export interface ScoringConfig {
  weights: Record<"recency" | "relevance" | "evidence" | "fit" | "relationship", number>;
  thresholds: { reachOutNow: number; prepareOutreach: number };
  reachOutMinRelevance: number;
  /** Multiplies evidence points: a post on social media is weaker proof than the investor's own site. */
  tierFactor: Record<SourceTier, number>;
  /** Upper bound on a signal's relevance given its topic (a design-materials round cannot be 70% relevant to logistics). */
  sectorCap: Record<SectorMatch, number>;
}

export const DEFAULT_CONFIG: ScoringConfig = {
  weights: { ...WEIGHTS },
  thresholds: { ...ACTION_THRESHOLDS },
  reachOutMinRelevance: REACH_OUT_MIN_RELEVANCE,
  tierFactor: { official: 1, press: 1, other: 0.85, social: 0.6 },
  sectorCap: { logistics: 100, b2b_software: 62, seed_generalist: 62, adjacent: 45, unrelated: 20 },
};

export interface ScoreInput {
  now: Date;
  /** Verified, non-duplicate signals. */
  signals: ScoredSignal[];
  profile: {
    stage_preference: string | null;
    sectors: string[];
    geography: string | null;
    thesis_text: string | null; // verified thesis if any, else workbook rationale
  };
  relationship: { status: RelationshipStatus; last_contact_date: string | null };
  /** Did retrieval for this investor cover everything we tried? */
  coverage: "complete" | "partial";
  config?: ScoringConfig;
}

export interface Component {
  points: number; // rounded to 1 dp
  max: number;
  note: string;
}

export interface ScoreResult {
  /** Reasons a score high enough for "reach out now" was held at a lower action. Empty when nothing was held back. */
  capped_by: string[];
  score: number; // integer 0–100
  breakdown: Record<"recency" | "relevance" | "evidence" | "fit" | "relationship", Component>;
  action: Action;
  explanation: string;
  lead_signal: ScoredSignal | null;
  relevant_signal_count: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

const CONFIDENCE_FACTOR: Record<Confidence, number> = { high: 1, medium: 0.65, low: 0.3 };

/** 1.0 for the first 3 days, then a straight line down to 0.2 at day 30. */
export function recencyFactor(ageDays: number): number {
  if (ageDays <= 3) return 1;
  return clamp(1 - (0.8 * (ageDays - 3)) / 27, 0.2, 1);
}

const has = (hay: string, re: RegExp) => re.test(hay.toLowerCase());

export function fitFactors(p: ScoreInput["profile"]) {
  const stage = p.stage_preference;
  const stageFit = !stage
    ? 0.3 // unknown is not evidence of fit
    : has(stage, /seed|angel|accelerator|very early/)
      ? 1
      : has(stage, /early/) && !has(stage, /early growth/)
        ? 0.8
        : has(stage, /series a|growth|scale/)
          ? 0.4
          : 0.3;
  const hay = [...p.sectors, p.thesis_text ?? ""].join(" ");
  const sectorFit = !hay.trim()
    ? 0.2
    : has(hay, /logistic|supply.?chain|freight|transport|warehous|fleet|mobility/)
      ? 1
      : has(hay, /b2b|enterprise|saas|software/)
        ? 0.6
        : 0.2;
  const geoFit = !p.geography ? 0.5 : has(p.geography, /india/) ? 1 : 0.4;
  return { stageFit, sectorFit, geoFit, fit: 0.4 * sectorFit + 0.4 * stageFit + 0.2 * geoFit };
}

function relationshipFactor(status: RelationshipStatus): { factor: number; note: string } {
  switch (status) {
    case "not_contacted": return { factor: 0.5, note: "cold — no prior contact" };
    case "contacted": return { factor: 0.8, note: "already contacted" };
    case "in_conversation": return { factor: 1, note: "active conversation" };
    case "awaiting_response": return { factor: 1, note: "awaiting their response" };
    case "passed": return { factor: 0, note: "investor has passed" };
    case "committed": return { factor: 0, note: "already committed" };
  }
}

/** Topic cap applied to the model's relevance. A signal with no second-pass review keeps its judged relevance. */
export const effectiveRelevance = (s: ScoredSignal, cfg: ScoringConfig = DEFAULT_CONFIG): number =>
  s.sector_match ? Math.min(s.relevance, cfg.sectorCap[s.sector_match]) : s.relevance;

const tierOf = (s: ScoredSignal): SourceTier => s.tier ?? "other";

/**
 * Why a cold approach is NOT yet justified, as human-readable reasons. Empty = the lead signal clears every gate.
 * These are gates on the ACTION only; the number itself is computed the same way regardless.
 */
export function reachOutBlockers(lead: ScoredSignal, relevant: ScoredSignal[], cfg: ScoringConfig = DEFAULT_CONFIG): string[] {
  const why: string[] = [];
  const eff = effectiveRelevance(lead, cfg);
  if (lead.confidence === "low") why.push("the evidence is low-confidence");
  if (eff < cfg.reachOutMinRelevance) why.push(`its relevance to ${STARTUP.sector} is only ${eff}/100 (needs ${cfg.reachOutMinRelevance}+)`);
  switch (lead.sector_match) {
    case "logistics": break;
    case "b2b_software":
    case "seed_generalist":
      if (!lead.new_capital) why.push("it shows general seed or B2B-software activity, not logistics, and announces no new capital");
      break;
    case "adjacent": why.push("the deal is in an adjacent sector, not logistics or supply chain"); break;
    case "unrelated": why.push("the signal is unrelated to logistics or supply chain"); break;
    default: why.push("the signal has not had its second-pass sector review yet");
  }
  if (tierOf(lead) === "social" && !relevant.some((s) => s !== lead && tierOf(s) !== "social"))
    why.push("the only support is a social-media post (needs a second, non-social source)");
  return why;
}

export function scoreInvestor(input: ScoreInput): ScoreResult {
  const { now, profile, relationship } = input;
  const cfg = input.config ?? DEFAULT_CONFIG;
  const W = cfg.weights;
  const strength = (s: ScoredSignal) => effectiveRelevance(s, cfg) * recencyFactor(ageInDays(s.published_at, now)) * cfg.tierFactor[tierOf(s)];
  const relevant = input.signals
    .filter((s) => effectiveRelevance(s, cfg) >= RELEVANCE_MIN && ageInDays(s.published_at, now) >= -1 && ageInDays(s.published_at, now) <= 30)
    .sort((a, b) => strength(b) - strength(a));
  const lead = relevant[0] ?? null;

  const fit = fitFactors(profile);
  const rel = relationshipFactor(relationship.status);

  let recency = 0, relevance = 0, evidence = 0;
  let recencyNote = "no relevant signal in the last 30 days";
  let relevanceNote = recencyNote;
  let evidenceNote = recencyNote;

  if (lead) {
    const age = Math.max(0, ageInDays(lead.published_at, now));
    const eff = effectiveRelevance(lead, cfg);
    const gate = clamp(eff / FULL_RELEVANCE); // recency/evidence only count as far as the signal is relevant
    const corroborated = new Set(relevant.map((s) => s.published_at + "|" + (s.headline ?? s.id ?? ""))).size >= 2;
    const tierF = cfg.tierFactor[tierOf(lead)];
    const evFactor = clamp((CONFIDENCE_FACTOR[lead.confidence] + (corroborated ? 0.15 : 0)) * tierF);
    recency = W.recency * recencyFactor(age) * gate;
    relevance = W.relevance * (eff / 100);
    evidence = W.evidence * evFactor * gate;
    recencyNote = `lead signal is ${age} day${age === 1 ? "" : "s"} old` + (gate < 1 ? `, scaled by relevance (${Math.round(gate * 100)}%)` : "");
    relevanceNote = `relevance ${eff}/100 to ${STARTUP.sector}` + (eff < lead.relevance ? ` (judged ${lead.relevance}, capped for a ${lead.sector_match?.replace(/_/g, " ")} topic)` : "");
    evidenceNote = `${lead.confidence} confidence${corroborated ? ", corroborated by a second event" : ""}` + (tierF < 1 ? `, ${tierOf(lead)} source counts ${Math.round(tierF * 100)}%` : "") + (gate < 1 ? `, scaled by relevance` : "");
  }

  const fitPts = W.fit * fit.fit;
  const relPts = W.relationship * rel.factor;
  const total = Math.round(recency + relevance + evidence + fitPts + relPts);
  const score = Math.max(0, Math.min(100, total));

  const breakdown: ScoreResult["breakdown"] = {
    recency: { points: r1(recency), max: W.recency, note: recencyNote },
    relevance: { points: r1(relevance), max: W.relevance, note: relevanceNote },
    evidence: { points: r1(evidence), max: W.evidence, note: evidenceNote },
    fit: {
      points: r1(fitPts),
      max: W.fit,
      note: `sector ${Math.round(fit.sectorFit * 100)}%, stage ${Math.round(fit.stageFit * 100)}%, geography ${Math.round(fit.geoFit * 100)}%`,
    },
    relationship: { points: r1(relPts), max: W.relationship, note: rel.note },
  };

  const blockers = lead ? reachOutBlockers(lead, relevant, cfg) : [];
  const { action, why, capped_by } = chooseAction({ score, lead, blockers, relevantCount: relevant.length, relationship, coverage: input.coverage, fit: fit.fit, now, cfg });
  const parts = Object.entries(breakdown).map(([k, c]) => `${k} ${c.points}/${c.max}`);
  return {
    score,
    breakdown,
    action,
    capped_by,
    explanation: `${why} Score ${score}/100 (${parts.join(", ")}).`,
    lead_signal: lead,
    relevant_signal_count: relevant.length,
  };
}

function chooseAction(a: {
  score: number;
  lead: ScoredSignal | null;
  blockers: string[];
  relevantCount: number;
  relationship: ScoreInput["relationship"];
  coverage: "complete" | "partial";
  fit: number;
  now: Date;
  cfg: ScoringConfig;
}): { action: Action; why: string; capped_by: string[] } {
  const { status, last_contact_date } = a.relationship;
  const none: string[] = [];
  if (status === "passed") return { action: "no_action", capped_by: none, why: "This investor has already passed; do not re-contact on a new article alone." };
  if (status === "committed") return { action: "no_action", capped_by: none, why: "This investor has already committed." };
  if (status === "awaiting_response") {
    const days = last_contact_date ? ageInDays(last_contact_date, a.now) : null;
    if (days === null || days <= 14)
      return { action: "wait_for_response", capped_by: none, why: `You are awaiting their reply${days === null ? "" : ` (contacted ${days} day${days === 1 ? "" : "s"} ago)`}; wait rather than chase.` };
  }
  const { reachOutNow, prepareOutreach } = a.cfg.thresholds;
  if (a.lead) {
    if (a.score >= reachOutNow) {
      if (a.blockers.length === 0)
        return { action: "reach_out_now", capped_by: none, why: `A recent, relevant, well-evidenced signal supports reaching out now: ${(a.lead.headline ?? "see evidence").replace(/[.\s]+$/, "")}.` };
      const offTopic = a.lead.sector_match === "adjacent" || a.lead.sector_match === "unrelated";
      return {
        action: offTopic ? "research_further" : "prepare_targeted_outreach",
        capped_by: a.blockers,
        why: `The score clears ${reachOutNow}, but a cold approach is not justified yet: ${a.blockers.join("; ")}. ${offTopic ? "Check whether the firm also backs logistics before spending effort." : "Prepare a targeted message that references the signal."}`,
      };
    }
    const adjacent = a.lead.sector_match === "adjacent" || a.lead.sector_match === "unrelated";
    if (a.score >= prepareOutreach && adjacent)
      return { action: "research_further", capped_by: a.blockers, why: `The signal is in an adjacent sector, not logistics or supply chain: ${a.blockers.join("; ")}. Check whether the firm also backs logistics before spending effort.` };
    if (a.score >= prepareOutreach)
      return { action: "prepare_targeted_outreach", capped_by: none, why: `There is a relevant signal but it is not strong enough for a cold approach; prepare a targeted message that references it.` };
    return { action: "research_further", capped_by: none, why: "A relevant signal exists but the case is weak (age, confidence or relevance); verify before spending outreach effort." };
  }
  if (a.coverage === "partial") return { action: "research_further", capped_by: none, why: "No verified signal was found, but some sources failed or were unavailable, so absence of signal is not conclusive." };
  if (a.fit >= 0.7) return { action: "research_further", capped_by: none, why: "No verified signal this window, but the profile is a strong fit; check their site manually and revisit." };
  return { action: "no_action", capped_by: none, why: "Search completed with no relevant signal in the last 30 days, and the profile is not a standout fit." };
}
