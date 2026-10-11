import { describe, expect, it } from "vitest";
import { distinctPoints, explainMoves, type Breakdown, type HistoryPoint } from "@/lib/history";

const bd = (recency: number, relevance = 25, evidence = 15): Breakdown => ({
  recency: { points: recency, max: 30, note: "" }, relevance: { points: relevance, max: 30, note: "" }, evidence: { points: evidence, max: 20, note: "" },
  fit: { points: 14, max: 15, note: "" }, relationship: { points: 2.5, max: 5, note: "" },
});
const pt = (day: number, score: number, action: string, breakdown: Breakdown | null, source: "refresh" | "rescore" = "refresh"): HistoryPoint =>
  ({ at: `2026-10-${String(day).padStart(2, "0")}T04:00:00Z`, source, score, action, breakdown });

describe("explainMoves", () => {
  it("names the factor that moved the score the most, in plain words", () => {
    const m = explainMoves([pt(1, 88, "reach_out_now", bd(30)), pt(8, 80, "reach_out_now", bd(22))]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ delta: -8, from: 88, to: 80 });
    expect(m[0]!.drivers[0]).toEqual({ factor: "recency", delta: -8 });
    expect(m[0]!.reason).toMatch(/Down 8 points: the lead signal is getting older/);
  });

  it("reports an action change even when the score barely moved, and says so", () => {
    const m = explainMoves([pt(1, 76, "reach_out_now", bd(30)), pt(2, 74, "prepare_targeted_outreach", bd(29))]);
    expect(m[0]!.reason).toMatch(/moved from “reach out now” to “prepare targeted outreach”/);
  });

  it("ignores small wobbles and identical re-scores", () => {
    expect(explainMoves([pt(1, 70, "prepare_targeted_outreach", bd(20)), pt(2, 69, "prepare_targeted_outreach", bd(19.5)), pt(3, 69, "prepare_targeted_outreach", bd(19.5), "rescore")])).toEqual([]);
  });

  it("an increase is described as such, and a missing breakdown never throws", () => {
    expect(explainMoves([pt(1, 40, "research_further", bd(5)), pt(5, 70, "prepare_targeted_outreach", bd(30))])[0]!.reason).toMatch(/Up 30 points: a fresher signal arrived/);
    expect(explainMoves([pt(1, 40, "research_further", null), pt(5, 70, "prepare_targeted_outreach", null)])[0]!.drivers).toEqual([]);
  });

  it("fewer than two points means no moves", () => {
    expect(explainMoves([])).toEqual([]);
    expect(explainMoves([pt(1, 50, "research_further", null)])).toEqual([]);
  });
});

describe("distinctPoints", () => {
  it("keeps the first and last point and every change, and drops flat repeats", () => {
    const p = [pt(1, 50, "a", null), pt(2, 50, "a", null), pt(3, 50, "a", null), pt(4, 60, "a", null), pt(5, 60, "a", null)];
    expect(distinctPoints(p).map((x) => x.at.slice(8, 10))).toEqual(["01", "04", "05"]);
  });
});
