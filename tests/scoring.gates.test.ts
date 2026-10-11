import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, effectiveRelevance, reachOutBlockers, scoreInvestor, type ScoredSignal, type ScoreInput } from "@/lib/scoring/score";

const NOW = new Date("2026-10-11T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const sig = (o: Partial<ScoredSignal> = {}): ScoredSignal => ({ id: "s1", published_at: daysAgo(2), relevance: 90, confidence: "high", headline: "X backs a freight marketplace", sector_match: "logistics", tier: "press", ...o });
const input = (signals: ScoredSignal[], o: Partial<ScoreInput> = {}): ScoreInput => ({
  now: NOW, signals,
  profile: { stage_preference: "Seed", sectors: ["Logistics"], geography: "India", thesis_text: null },
  relationship: { status: "not_contacted", last_contact_date: null }, coverage: "complete", ...o,
});

describe("'reach out now' needs more than a high number", () => {
  it("a clean logistics signal from press clears every gate", () => {
    const r = scoreInvestor(input([sig()]));
    expect(r.action).toBe("reach_out_now");
    expect(r.capped_by).toEqual([]);
  });

  it("an adjacent-sector deal can score high on paper but is held at research, with the reason stated", () => {
    // judged 70 relevant by the first pass, but the second pass says the deal is in another vertical
    const r = scoreInvestor(input([sig({ relevance: 70, sector_match: "adjacent" })]));
    expect(r.action).toBe("research_further");
    expect(r.capped_by.join(" ")).toMatch(/adjacent sector/);
    expect(r.breakdown.relevance.note).toMatch(/judged 70, capped/);
    expect(effectiveRelevance(sig({ relevance: 70, sector_match: "adjacent" }))).toBe(45);
  });

  it("an unrelated signal is capped below the relevance floor: it is not a relevant signal at all", () => {
    const r = scoreInvestor(input([sig({ relevance: 80, sector_match: "unrelated" })]));
    expect(r.lead_signal).toBeNull();
    expect(r.relevant_signal_count).toBe(0);
  });

  it("general seed activity needs NEW CAPITAL to justify a cold approach (a fund close, a bigger cheque ceiling)", () => {
    const plain = scoreInvestor(input([sig({ sector_match: "seed_generalist", relevance: 80 })]));
    expect(plain.action).toBe("prepare_targeted_outreach");
    expect(plain.capped_by.join(" ")).toMatch(/no new capital/);
    const fund = scoreInvestor(input([sig({ sector_match: "seed_generalist", relevance: 80, new_capital: true })]));
    expect(fund.action).toBe("reach_out_now");
  });

  it("a signal that has not had its second-pass review can rank, but cannot trigger 'reach out now'", () => {
    const r = scoreInvestor(input([sig({ sector_match: null })]));
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.action).toBe("prepare_targeted_outreach");
    expect(r.capped_by.join(" ")).toMatch(/second-pass sector review/);
  });

  it("a lone social-media post cannot justify a cold approach, but a second non-social source lifts the hold", () => {
    const post = sig({ id: "p", tier: "social", relevance: 95 });
    const alone = scoreInvestor(input([post]));
    expect(alone.action).not.toBe("reach_out_now");
    expect(alone.capped_by.join(" ")).toMatch(/social-media post/);
    const corroborated = scoreInvestor(input([post, sig({ id: "n", tier: "press", relevance: 65, published_at: daysAgo(6), headline: "Press covers the same firm's other deal" })]));
    expect(reachOutBlockers(corroborated.lead_signal!, [post, sig({ id: "n", tier: "press" })])).toEqual([]);
    expect(corroborated.action).toBe("reach_out_now");
  });

  it("low-confidence evidence never triggers outreach", () => {
    expect(scoreInvestor(input([sig({ confidence: "low" })])).capped_by.join(" ")).toMatch(/low-confidence/);
  });

  it("the lead is the strongest signal after source quality, not merely the newest", () => {
    const r = scoreInvestor(input([sig({ id: "post", tier: "social", relevance: 80, published_at: daysAgo(1) }), sig({ id: "press", tier: "press", relevance: 80, published_at: daysAgo(3) })]));
    expect(r.lead_signal?.id).toBe("press");
  });

  it("a weaker source earns fewer evidence points for the same event", () => {
    const press = scoreInvestor(input([sig({ tier: "press" })])).breakdown.evidence.points;
    const social = scoreInvestor(input([sig({ tier: "social" })])).breakdown.evidence.points;
    expect(social).toBeLessThan(press);
  });

  it("holds when the relationship rules say wait or stop, whatever the gates say", () => {
    expect(scoreInvestor(input([sig()], { relationship: { status: "passed", last_contact_date: null } })).action).toBe("no_action");
    expect(scoreInvestor(input([sig()], { relationship: { status: "awaiting_response", last_contact_date: daysAgo(3) } })).action).toBe("wait_for_response");
  });
});

describe("ScoringConfig (the what-if page uses it; production uses DEFAULT_CONFIG)", () => {
  it("the default config reproduces the production score exactly", () => {
    const i = input([sig({ relevance: 72, published_at: daysAgo(9), confidence: "medium" })]);
    expect(scoreInvestor({ ...i, config: DEFAULT_CONFIG })).toEqual(scoreInvestor(i));
  });

  it("changing a weight or a threshold changes the number or the action, and nothing else is hidden", () => {
    const i = input([sig({ relevance: 72, published_at: daysAgo(9), confidence: "medium" })]);
    const base = scoreInvestor(i);
    const recencyHeavy = scoreInvestor({ ...i, config: { ...DEFAULT_CONFIG, weights: { ...DEFAULT_CONFIG.weights, recency: 50, relevance: 10 } } });
    expect(recencyHeavy.score).not.toBe(base.score);
    const strict = scoreInvestor({ ...i, config: { ...DEFAULT_CONFIG, thresholds: { reachOutNow: 99, prepareOutreach: 90 } } });
    expect(strict.action).toBe("research_further");
  });
});
