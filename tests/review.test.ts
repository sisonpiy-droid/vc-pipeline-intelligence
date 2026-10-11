import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiError } from "@/lib/ai/gemini";
import { isJunkHeadline, pickDisplayHeadline, reviewSignals } from "@/lib/ai/review";
import type { Db } from "@/lib/db";
import { runChunk, startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";
import { article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

const target = { firm_name: "Kae Capital", aliases: [] as string[] };

describe("headline rules", () => {
  it("recognises titles that cannot stand as a headline", () => {
    for (const junk of ["- YouTube", "Instagram", "Sid Choudhury's Post", "Jobs Territory’s Post", "News List | William Blair", "Startup & venture capital news | Dealroom.co", "Hello"])
      expect(isJunkHeadline(junk), junk).toBe(true);
    for (const fine of ["Drivn Raises Rs 45 Crore Seed Funding From Avaana Capital", "Building 10-Minute Cities in India - Kae Capital", "Peak XV ups Surge seed investment ceiling to $5M"])
      expect(isJunkHeadline(fine), fine).toBe(false);
  });

  it("uses the model's headline only when the title is unusable or names another firm, and the new one names the investor", () => {
    expect(pickDisplayHeadline("- YouTube", "Kae Capital partner discusses seed investing on a podcast", target)).toMatch(/Kae Capital/);
    expect(pickDisplayHeadline("Kae Capital backs a freight startup", "Kae Capital invests in a freight startup", target)).toBeNull(); // original is fine
    expect(pickDisplayHeadline("LegaLogic Advises Enemtech Capital on Investment", "Kae Capital invests in a fintech startup seed round", target)).toMatch(/Kae Capital/); // names someone else
    expect(pickDisplayHeadline("- YouTube", "A partner discusses seed investing on a podcast", target)).toBeNull(); // new one does not name the investor
    expect(pickDisplayHeadline("- YouTube", "x".repeat(200) + " Kae Capital", target)).toBeNull(); // too long
    expect(pickDisplayHeadline("- YouTube", "Kae Capital: see https://evil.example now please", target)).toBeNull(); // no links
    expect(pickDisplayHeadline("- YouTube", null, target)).toBeNull();
  });
});

describe("reviewSignals validation", () => {
  const items = [{ index: 0, title: "t", summary: "s", excerpt: "e", source: "x.com", published_at: "2026-10-01" }];
  const inv = { firm_name: "Kae Capital", aliases: [], entity_type: "vc_firm" };

  it("returns validated verdicts, and leaves an item the model omitted un-reviewed rather than guessing", async () => {
    const ai = { generateJson: async () => ({ reviews: [{ index: 0, firm_acting: true, sector_match: "logistics", clean_headline: " ", note: "" }] }) };
    const r = await reviewSignals(ai, inv, [...items, { ...items[0]!, index: 1 }]);
    expect(r.ok && r.verdicts).toEqual([{ index: 0, firm_acting: true, sector_match: "logistics", clean_headline: null, note: null }]);
  });

  it("an invalid answer is retried once with the validation error, then reported as a failure — never trusted", async () => {
    let calls = 0;
    const prompts: string[] = [];
    const ai = { generateJson: async (req: { prompt: string }) => { calls++; prompts.push(req.prompt); return { reviews: [{ index: 0, firm_acting: "yes", sector_match: "made_up", clean_headline: "", note: "" }] }; } };
    const r = await reviewSignals(ai, inv, items);
    expect(r).toMatchObject({ ok: false, category: "invalid_output" });
    expect(calls).toBe(2);
    expect(prompts[1]).toMatch(/previous reply was rejected/);
  });

  it("a Gemini outage is a typed failure", async () => {
    const r = await reviewSignals({ generateJson: async () => { throw new AiError("rate_limited", "429"); } }, inv, items);
    expect(r).toMatchObject({ ok: false, category: "rate_limited" });
  });

  it("makes no call at all when there is nothing to review", async () => {
    let calls = 0;
    expect(await reviewSignals({ generateJson: async () => { calls++; return {}; } }, inv, [])).toEqual({ ok: true, verdicts: [], ai_calls: 0 });
    expect(calls).toBe(0);
  });
});

describe("the second pass inside a refresh", () => {
  let db: Db;
  let rdb: Db;
  const u = "https://news.example/alpha";
  beforeAll(async () => { db = await makeTestDb(); rdb = asRefresh(db); });
  afterAll(() => db.close());
  beforeEach(async () => {
    await db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs, score_history restart identity cascade");
    await db.query(`insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography) values ('vc_firm', 'alpha', 'Alpha', 'https://alpha.vc', 'Seed', '{Logistics}', 'India')`);
  });
  const run = async (ai: ReturnType<typeof fakeAi>) => {
    const deps = mkDeps(fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(2))] }), fakePages({ [u]: article("Alpha", daysAgo(2)) }), ai);
    const { run_id } = await startRun(rdb, "manual");
    await runChunk(rdb, deps, run_id, { batchEstimateMs: 0 });
    return run_id;
  };
  const inv = async () => (await db.query(`select recommended_action a, follow_up_score s from investors`)).rows[0] as { a: string; s: number };
  const sig = async () => (await db.query(`select verification_status v, rejection_reason r, sector_match sm, firm_acting fa, display_headline dh, review_note n, reviewed_at is not null reviewed from signals`)).rows[0] as Record<string, unknown>;
  const cov = async () => (await db.query(`select status, error_category, note from source_coverage where source = 'gemini_review'`)).rows[0] as { status: string; error_category: string | null; note: string | null };

  it("stores the verdict next to the evidence, and the score uses it", async () => {
    await run(fakeAi());
    expect(await sig()).toMatchObject({ v: "verified", sm: "logistics", fa: true, reviewed: true });
    expect((await inv()).a).toBe("reach_out_now");
    expect(await cov()).toMatchObject({ status: "ok" });
  });

  it("a signal whose excerpt shows a DIFFERENT firm acting is rejected, so it cannot rank anyone", async () => {
    await run(fakeAi({}, "ok", undefined, () => ({ firm_acting: false, note: "Page is about Big Alpha, a different firm" })));
    expect(await sig()).toMatchObject({ v: "rejected", r: "second_pass_not_acting", fa: false, n: "Page is about Big Alpha, a different firm" });
    expect((await inv()).a).not.toBe("reach_out_now");
    expect((await inv()).s).toBeLessThanOrEqual(20); // only fit + relationship remain
    expect((await cov()).note).toMatch(/1 signal rejected/);
  });

  it("an adjacent-sector deal is stored as such and held at 'research further'", async () => {
    await run(fakeAi({}, "ok", undefined, () => ({ sector_match: "adjacent" })));
    expect(await sig()).toMatchObject({ v: "verified", sm: "adjacent" });
    expect((await inv()).a).toBe("research_further");
    const h = (await db.query(`select capped_by from score_history`)).rows[0] as { capped_by: string[] };
    expect(h.capped_by.join(" ")).toMatch(/adjacent sector/);
  });

  it("a review outage never fails the investor: the signal stays un-reviewed, coverage records why, and outreach is held at 'prepare'", async () => {
    const id = await run(fakeAi({}, "ok", undefined, new AiError("unavailable", "Gemini down")));
    expect(await sig()).toMatchObject({ v: "verified", sm: null, fa: null, reviewed: false });
    expect(await cov()).toMatchObject({ status: "error", error_category: "unavailable" });
    expect((await inv()).a).toBe("prepare_targeted_outreach");
    expect(((await db.query(`select status from run_items where run_id = $1`, [id])).rows[0] as { status: string }).status).toBe("done");
  });

  it("replaces an unusable title with the model's headline, and keeps the page's own title for provenance", async () => {
    await db.query("delete from investors");
    await db.query(`insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography) values ('vc_firm', 'alpha', 'Alpha', 'https://alpha.vc', 'Seed', '{Logistics}', 'India')`);
    const page = article("Alpha", daysAgo(2)).replace(/<title>[^<]*<\/title>/, "<title>Alpha's Post</title>");
    const deps = mkDeps(fakeSearch({ Alpha: [{ ...hit(u, "Alpha", daysAgo(2)), title: "Alpha's Post" }] }), fakePages({ [u]: page }), fakeAi({}, "ok", undefined, () => ({ clean_headline: "Alpha led a Seed round in a freight marketplace" })));
    const { run_id } = await startRun(rdb, "manual");
    await runChunk(rdb, deps, run_id, { batchEstimateMs: 0 });
    const row = (await db.query(`select headline, display_headline from signals`)).rows[0] as { headline: string; display_headline: string };
    expect(row.headline).toBe("Alpha's Post");
    expect(row.display_headline).toBe("Alpha led a Seed round in a freight marketplace");
  });
});
