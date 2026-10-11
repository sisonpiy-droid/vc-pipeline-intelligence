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

export interface ScoredSignal {
  id?: string;
  published_at: string; // YYYY-MM-DD, already validated as in-window by the caller (re-checked here)
  relevance: number; // 0–100, model judgement of relevance to STARTUP
  confidence: Confidence; // evidence quality
  headline?: string;
}

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
}

export interface Component {
  points: number; // rounded to 1 dp
  max: number;
  note: string;
}

export interface ScoreResult {
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

export function scoreInvestor(input: ScoreInput): ScoreResult {
  const { now, profile, relationship } = input;
  const relevant = input.signals
    .filter((s) => s.relevance >= RELEVANCE_MIN && ageInDays(s.published_at, now) >= -1 && ageInDays(s.published_at, now) <= 30)
    .sort((a, b) => b.relevance * recencyFactor(ageInDays(b.published_at, now)) - a.relevance * recencyFactor(ageInDays(a.published_at, now)));
  const lead = relevant[0] ?? null;

  const fit = fitFactors(profile);
  const rel = relationshipFactor(relationship.status);

  let recency = 0, relevance = 0, evidence = 0;
  let recencyNote = "no relevant signal in the last 30 days";
  let relevanceNote = recencyNote;
  let evidenceNote = recencyNote;

  if (lead) {
    const age = Math.max(0, ageInDays(lead.published_at, now));
    const gate = clamp(lead.relevance / FULL_RELEVANCE); // recency/evidence only count as far as the signal is relevant
    const corroborated = new Set(relevant.map((s) => s.published_at + "|" + (s.headline ?? s.id ?? ""))).size >= 2;
    const evFactor = clamp(CONFIDENCE_FACTOR[lead.confidence] + (corroborated ? 0.15 : 0));
    recency = WEIGHTS.recency * recencyFactor(age) * gate;
    relevance = WEIGHTS.relevance * (lead.relevance / 100);
    evidence = WEIGHTS.evidence * evFactor * gate;
    recencyNote = `lead signal is ${age} day${age === 1 ? "" : "s"} old` + (gate < 1 ? `, scaled by relevance (${Math.round(gate * 100)}%)` : "");
    relevanceNote = `relevance ${lead.relevance}/100 to ${STARTUP.sector}`;
    evidenceNote = `${lead.confidence} confidence${corroborated ? ", corroborated by a second event" : ""}` + (gate < 1 ? `, scaled by relevance` : "");
  }

  const fitPts = WEIGHTS.fit * fit.fit;
  const relPts = WEIGHTS.relationship * rel.factor;
  const total = Math.round(recency + relevance + evidence + fitPts + relPts);
  const score = Math.max(0, Math.min(100, total));

  const breakdown: ScoreResult["breakdown"] = {
    recency: { points: r1(recency), max: WEIGHTS.recency, note: recencyNote },
    relevance: { points: r1(relevance), max: WEIGHTS.relevance, note: relevanceNote },
    evidence: { points: r1(evidence), max: WEIGHTS.evidence, note: evidenceNote },
    fit: {
      points: r1(fitPts),
      max: WEIGHTS.fit,
      note: `sector ${Math.round(fit.sectorFit * 100)}%, stage ${Math.round(fit.stageFit * 100)}%, geography ${Math.round(fit.geoFit * 100)}%`,
    },
    relationship: { points: r1(relPts), max: WEIGHTS.relationship, note: rel.note },
  };

  const { action, why } = chooseAction({ score, lead, relevantCount: relevant.length, relationship, coverage: input.coverage, fit: fit.fit, now });
  const parts = Object.entries(breakdown).map(([k, c]) => `${k} ${c.points}/${c.max}`);
  return {
    score,
    breakdown,
    action,
    explanation: `${why} Score ${score}/100 (${parts.join(", ")}).`,
    lead_signal: lead,
    relevant_signal_count: relevant.length,
  };
}

function chooseAction(a: {
  score: number;
  lead: ScoredSignal | null;
  relevantCount: number;
  relationship: ScoreInput["relationship"];
  coverage: "complete" | "partial";
  fit: number;
  now: Date;
}): { action: Action; why: string } {
  const { status, last_contact_date } = a.relationship;
  if (status === "passed") return { action: "no_action", why: "This investor has already passed; do not re-contact on a new article alone." };
  if (status === "committed") return { action: "no_action", why: "This investor has already committed." };
  if (status === "awaiting_response") {
    const days = last_contact_date ? ageInDays(last_contact_date, a.now) : null;
    if (days === null || days <= 14)
      return { action: "wait_for_response", why: `You are awaiting their reply${days === null ? "" : ` (contacted ${days} day${days === 1 ? "" : "s"} ago)`}; wait rather than chase.` };
  }
  if (a.lead) {
    if (a.score >= ACTION_THRESHOLDS.reachOutNow)
      return { action: "reach_out_now", why: `A recent, relevant, well-evidenced signal supports reaching out now: ${(a.lead.headline ?? "see evidence").replace(/[.\s]+$/, "")}.` };
    if (a.score >= ACTION_THRESHOLDS.prepareOutreach)
      return { action: "prepare_targeted_outreach", why: `There is a relevant signal but it is not strong enough for a cold approach; prepare a targeted message that references it.` };
    return { action: "research_further", why: "A relevant signal exists but the case is weak (age, confidence or relevance); verify before spending outreach effort." };
  }
  if (a.coverage === "partial") return { action: "research_further", why: "No verified signal was found, but some sources failed or were unavailable, so absence of signal is not conclusive." };
  if (a.fit >= 0.7) return { action: "research_further", why: "No verified signal this window, but the profile is a strong fit; check their site manually and revisit." };
  return { action: "no_action", why: "Search completed with no relevant signal in the last 30 days, and the profile is not a standout fit." };
}
