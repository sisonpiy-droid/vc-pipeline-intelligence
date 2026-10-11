import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateAngle, groundedIn } from "@/lib/ai/angle";
import { AiError } from "@/lib/ai/gemini";
import type { Db } from "@/lib/db";
import { runChunk, startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";
import { article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

const EV = { headline: "Avaana Capital leads Rs 45 crore seed round in Drivn", summary: "Avaana invested Rs 45 crore (about $4.7 million) in Drivn.", excerpt: "Drivn has raised Rs 45 crore in seed funding from Avaana Capital.", published_at: "2026-09-21" };

describe("groundedIn", () => {
  it("accepts numbers that appear in the evidence (with or without thousands separators)", () => {
    expect(groundedIn("Saw the Rs 45 crore seed into Drivn.", "Rs 45 crore")).toBe(true);
    expect(groundedIn("Congrats on the 4,700,000 raise.", "raised 4700000 in total")).toBe(true);
    expect(groundedIn("No figures at all here, just a warm opening.", "anything")).toBe(true);
  });
  it("rejects invented numbers and any link", () => {
    expect(groundedIn("Congrats on the $50 million close.", "Rs 45 crore")).toBe(false);
    expect(groundedIn("See https://example.com for our deck.", "x")).toBe(false);
    expect(groundedIn("Visit www.example.com", "x")).toBe(false);
  });
});

describe("generateAngle", () => {
  const ai = (reply: unknown) => ({ calls: 0, async generateJson() { if (reply instanceof Error) throw reply; return reply; } });
  it("returns a grounded suggestion", async () => {
    expect(await generateAngle(ai({ angle: "Congratulations on leading the Rs 45 crore seed into Drivn; we are building for the same fleets." }), "Avaana Capital", EV)).toMatch(/Rs 45 crore/);
  });
  it("returns null (never throws) for invalid, ungrounded, linked, or failed output", async () => {
    expect(await generateAngle(ai({ angle: "too short" }), "A", EV)).toBeNull();
    expect(await generateAngle(ai({ nope: 1 }), "A", EV)).toBeNull();
    expect(await generateAngle(ai({ angle: "Congratulations on your $90 million fund, we would love to chat about it." }), "A", EV)).toBeNull();
    expect(await generateAngle(ai({ angle: "Congratulations on the seed round, details at https://evil.example/deck for you." }), "A", EV)).toBeNull();
    expect(await generateAngle(ai(new AiError("unavailable", "down")), "A", EV)).toBeNull();
  });
  it("treats the event text as untrusted data", async () => {
    let seen = "";
    await generateAngle({ async generateJson(r) { seen = r.system; return { angle: "x" }; } }, "A", EV);
    expect(seen).toMatch(/UNTRUSTED DATA/);
  });
});

describe("angle in the pipeline", () => {
  let db: Db;
  let rdb: Db;
  const u = "https://news.example/alpha";
  beforeAll(async () => { db = await makeTestDb(); rdb = asRefresh(db); });
  afterAll(() => db.close());
  beforeEach(async () => {
    await db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs restart identity cascade");
    for (const n of ["Alpha", "Beta"]) await db.query(`insert into investors (entity_type, name_key, firm_name, stage_preference, sectors, geography) values ('vc_firm', $1, $2, 'Seed', '{Logistics}', 'India')`, [n.toLowerCase(), n]);
  });
  const run = async (ai: ReturnType<typeof fakeAi>, relevance = 92) => {
    const deps = mkDeps(fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(2))], Beta: [] }), fakePages({ [u]: article("Alpha", daysAgo(2)) }), ai);
    const { run_id } = await startRun(rdb, "manual");
    await runChunk(rdb, deps, run_id, { batchEstimateMs: 0 });
    return run_id;
  };
  const angleOf = async (run_id: string) => ((await db.query(`select outcome->>'angle' a from run_items ri join investors i on i.id=ri.investor_id where run_id=$1 and i.firm_name='Alpha'`, [run_id])).rows[0] as { a: string | null }).a;

  it("is stored for a 'reach out now' investor, but never for others (no wasted AI calls)", async () => {
    const ai = fakeAi({ [u]: { relevance: 92 } });
    const id = await run(ai);
    expect(await angleOf(id)).toMatch(/freight marketplace/);
    expect((await db.query(`select count(*)::int n from run_items where run_id=$1 and outcome ? 'angle'`, [id])).rows[0]).toEqual({ n: 1 });
    expect(ai.prompts.filter((p) => p.includes("<event"))).toHaveLength(1); // one angle call: Beta had no signal
  });

  it("is reused while the lead signal is unchanged — a second run makes no second angle call", async () => {
    const ai = fakeAi({ [u]: { relevance: 92 } });
    const first = await run(ai);
    const before = ai.calls;
    const second = await run(ai);
    expect(ai.calls).toBe(before);
    expect(await angleOf(second)).toBe(await angleOf(first));
  });

  it("an AI failure or an ungrounded angle leaves the investor's refresh intact, just without a suggestion", async () => {
    for (const bad of [new AiError("unavailable", "down"), "Congratulations on your $999 million fund, we would love to chat."]) {
      await db.exec("truncate runs, run_items, signals, source_coverage, audit_logs restart identity cascade");
      const id = await run(fakeAi({ [u]: { relevance: 92 } }, "ok", bad));
      expect(await angleOf(id)).toBeNull();
      expect((await db.query(`select status from run_items where run_id=$1`, [id])).rows.every((r) => (r as { status: string }).status === "done")).toBe(true);
      expect(((await db.query(`select recommended_action a from investors where firm_name='Alpha'`)).rows[0] as { a: string }).a).toBe("reach_out_now");
    }
  });
});
