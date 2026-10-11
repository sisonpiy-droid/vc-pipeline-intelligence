import { describe, expect, it } from "vitest";
import { cadence } from "@/lib/cadence";
import { scoreInvestor } from "@/lib/scoring/score";

const TODAY = "2026-10-11";
const ago = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

describe("cadence", () => {
  it("says nothing for investors you have not contacted, or who have decided", () => {
    for (const s of ["not_contacted", "passed", "committed"]) expect(cadence(s, ago(30), TODAY)).toBeNull();
  });

  it("contacted: wait, then nudge from day 7, then overdue after day 14", () => {
    expect(cadence("contacted", ago(3), TODAY)).toMatchObject({ kind: "wait", due: false });
    expect(cadence("contacted", ago(7), TODAY)).toMatchObject({ kind: "nudge", due: true, days: 7 });
    expect(cadence("contacted", ago(14), TODAY)).toMatchObject({ kind: "nudge" });
    expect(cadence("contacted", ago(15), TODAY)).toMatchObject({ kind: "overdue", due: true });
  });

  it("awaiting a reply: wait through day 14, exactly as the score engine does, then overdue", () => {
    expect(cadence("awaiting_response", ago(14), TODAY)).toMatchObject({ kind: "wait", due: false });
    expect(cadence("awaiting_response", ago(15), TODAY)).toMatchObject({ kind: "overdue", due: true });
  });

  it("in conversation: check in after 10 quiet days", () => {
    expect(cadence("in_conversation", ago(9), TODAY)).toMatchObject({ kind: "on_track", due: false });
    expect(cadence("in_conversation", ago(10), TODAY)).toMatchObject({ kind: "check_in", due: true });
  });

  it("a missing contact date is reported, never guessed", () => {
    expect(cadence("contacted", null, TODAY)).toMatchObject({ kind: "no_date", days: null, due: false });
  });

  it("agrees with the scoring engine: 'overdue' is exactly when 'wait for response' stops being the recommendation", () => {
    const base = { now: new Date(`${TODAY}T12:00:00Z`), signals: [], profile: { stage_preference: "Seed", sectors: ["Logistics"], geography: "India", thesis_text: null }, coverage: "complete" as const };
    for (const d of [10, 14, 15, 20]) {
      const action = scoreInvestor({ ...base, relationship: { status: "awaiting_response", last_contact_date: ago(d) } }).action;
      expect(action === "wait_for_response").toBe(cadence("awaiting_response", ago(d), TODAY)!.kind === "wait");
    }
  });
});
