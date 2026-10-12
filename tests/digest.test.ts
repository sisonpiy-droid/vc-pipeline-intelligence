import { describe, expect, it } from "vitest";
import { buildDigest } from "../src/lib/digest";
import type { PipelineRow } from "../src/lib/read";

const row = (o: Partial<PipelineRow>) => ({ is_demo: false, state: "active", recommended_action: "reach_out_now", relationship_status: "not_contacted", last_contact_date: null, follow_up_score: 80, ...o }) as unknown as PipelineRow;

describe("daily digest", () => {
  const rows = [
    row({ id: "a", firm_name: "Blume Ventures", lead: { headline: "Raises a new fund", tier: "official" } as never }),
    row({ id: "b", firm_name: "Quiet Capital", state: "quiet_complete", recommended_action: "no_action", follow_up_score: 10 }),
    row({ id: "c", firm_name: "Piyush: demo", is_demo: true }),
    row({ id: "d", firm_name: "Failed Fund", state: "failed", recommended_action: "no_action" }),
  ];
  const text = buildDigest(rows, "2026-10-12", "https://x.test", new Date("2026-10-12T04:00:00Z"));

  it("greets, counts the real pipeline only, and links to the evidence", () => {
    expect(text).toContain("Good morning, Vikram");
    expect(text).toContain("1 of 3 investors have a fresh, relevant signal");
    expect(text).toContain("1. Blume Ventures (score 80)");
    expect(text).toContain("https://x.test/investors/a");
    expect(text).toContain("Couldn't check yet: 1");
    expect(text).not.toContain("Piyush");
  });
});
