import { describe, expect, it } from "vitest";
import { ACTION_THRESHOLDS, WEIGHTS, recencyFactor, scoreInvestor, type ScoreInput } from "@/lib/scoring/score";

const NOW = new Date("2026-10-11T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const base: ScoreInput = {
  now: NOW,
  signals: [],
  profile: { stage_preference: "Seed / Pre-Series A", sectors: ["Logistics", "B2B SaaS"], geography: "India", thesis_text: null },
  relationship: { status: "not_contacted", last_contact_date: null },
  coverage: "complete",
};
const withSignal = (over: Partial<ScoreInput["signals"][number]> = {}, input: Partial<ScoreInput> = {}): ScoreInput => ({
  ...base,
  signals: [{ published_at: daysAgo(2), relevance: 90, confidence: "high", headline: "X invests in logistics SaaS", sector_match: "logistics", tier: "press", ...over }],
  ...input,
});

describe("weights", () => {
  it("sum to 100", () => expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100));
});

describe("recencyFactor", () => {
  it("is 1 for fresh signals and decays monotonically to 0.2 at day 30", () => {
    expect(recencyFactor(0)).toBe(1);
    expect(recencyFactor(3)).toBe(1);
    expect(recencyFactor(30)).toBeCloseTo(0.2, 5);
    for (let d = 3; d < 30; d++) expect(recencyFactor(d + 1)).toBeLessThan(recencyFactor(d));
  });
});

describe("scoreInvestor", () => {
  it("a fresh, highly relevant, high-confidence signal from a good-fit investor → reach out now", () => {
    const r = scoreInvestor(withSignal());
    expect(r.score).toBeGreaterThanOrEqual(ACTION_THRESHOLDS.reachOutNow);
    expect(r.action).toBe("reach_out_now");
    expect(r.lead_signal?.headline).toMatch(/logistics/);
  });

  it("is deterministic and its breakdown adds up to the score", () => {
    const a = scoreInvestor(withSignal({ published_at: daysAgo(9), relevance: 63, confidence: "medium" }));
    const b = scoreInvestor(withSignal({ published_at: daysAgo(9), relevance: 63, confidence: "medium" }));
    expect(a).toEqual(b);
    const sum = Object.values(a.breakdown).reduce((s, c) => s + c.points, 0);
    expect(Math.abs(sum - a.score)).toBeLessThanOrEqual(0.5 + 1e-9 * 5);
    for (const c of Object.values(a.breakdown)) expect(c.points).toBeLessThanOrEqual(c.max);
  });

  it("a recent but irrelevant article does NOT produce a high score or outreach", () => {
    const r = scoreInvestor(withSignal({ published_at: daysAgo(0), relevance: 15, confidence: "high" }));
    expect(r.score).toBeLessThanOrEqual(WEIGHTS.fit + WEIGHTS.relationship);
    expect(r.action).not.toBe("reach_out_now");
    expect(r.breakdown.recency.points).toBe(0);
  });

  it("an investor with no signal can never score above fit + relationship, and missing data does not inflate it", () => {
    const perfectFit = scoreInvestor({ ...base, relationship: { status: "in_conversation", last_contact_date: null } });
    expect(perfectFit.score).toBeLessThanOrEqual(WEIGHTS.fit + WEIGHTS.relationship);
    const unknownProfile = scoreInvestor({ ...base, profile: { stage_preference: null, sectors: [], geography: null, thesis_text: null } });
    expect(unknownProfile.score).toBeLessThan(perfectFit.score);
  });

  it("quiet + complete coverage + weak fit → no action; quiet + strong fit → research further", () => {
    const weak = scoreInvestor({ ...base, profile: { stage_preference: "Growth", sectors: ["consumer"], geography: "USA", thesis_text: null } });
    expect(weak.action).toBe("no_action");
    expect(scoreInvestor(base).action).toBe("research_further");
  });

  it("partial coverage with no signal is never 'no action' — absence is not conclusive", () => {
    const r = scoreInvestor({ ...base, coverage: "partial", profile: { ...base.profile, sectors: ["consumer"], stage_preference: "Growth" } });
    expect(r.action).toBe("research_further");
    expect(r.explanation).toMatch(/not conclusive/);
  });

  it("older signals score lower than fresher ones, all else equal", () => {
    const fresh = scoreInvestor(withSignal({ published_at: daysAgo(1) }));
    const old = scoreInvestor(withSignal({ published_at: daysAgo(28) }));
    expect(old.score).toBeLessThan(fresh.score);
  });

  it("ignores signals outside the 30-day window", () => {
    const r = scoreInvestor(withSignal({ published_at: daysAgo(45) }));
    expect(r.lead_signal).toBeNull();
    expect(r.breakdown.recency.points).toBe(0);
  });

  it("never recommends outreach to an investor who passed or committed, whatever the signal", () => {
    for (const status of ["passed", "committed"] as const) {
      const r = scoreInvestor(withSignal({}, { relationship: { status, last_contact_date: daysAgo(10) } }));
      expect(r.action).toBe("no_action");
    }
  });

  it("waits when a reply is pending and the contact is recent, but re-opens once it has gone stale", () => {
    const pending = (d: number) => withSignal({}, { relationship: { status: "awaiting_response", last_contact_date: daysAgo(d) } });
    expect(scoreInvestor(pending(5)).action).toBe("wait_for_response");
    expect(scoreInvestor(pending(30)).action).toBe("reach_out_now");
  });

  it("weak evidence lowers the action tier (relevance and confidence are separate inputs)", () => {
    const strong = scoreInvestor(withSignal({ relevance: 80, confidence: "high" }));
    const lowConf = scoreInvestor(withSignal({ relevance: 80, confidence: "low" }));
    expect(lowConf.breakdown.evidence.points).toBeLessThan(strong.breakdown.evidence.points);
    expect(lowConf.breakdown.relevance.points).toBe(strong.breakdown.relevance.points);
  });

  it("explains itself", () => {
    const r = scoreInvestor(withSignal());
    expect(r.explanation).toMatch(/Score \d+\/100/);
    expect(r.breakdown.recency.note).toMatch(/day/);
  });
});
