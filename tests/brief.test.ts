import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getBrief, getBudget, getFunnel } from "@/lib/brief";
import type { Db } from "@/lib/db";
import { ProviderError } from "@/lib/providers/types";
import { runChunk, startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";
import { article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

const TODAY = new Date().toISOString().slice(0, 10);
let db: Db;
let rdb: Db;

beforeAll(async () => {
  db = await makeTestDb();
  rdb = asRefresh(db);
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs restart identity cascade");
  for (const n of ["Alpha", "Beta", "Gamma"])
    await db.query(`insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography) values ('vc_firm', $1, $2, $3, 'Seed', '{Logistics}', 'India')`, [n.toLowerCase(), n, `https://${n.toLowerCase()}.vc`]);
});

// NOW in the fakes is fixed (2026-10-11); the read model filters on the wall clock, so build dates off the fake "now".
const run = async (world: { search: ReturnType<typeof fakeSearch>; pages: ReturnType<typeof fakePages>; ai: ReturnType<typeof fakeAi> }) => {
  const { run_id } = await startRun(rdb, "manual");
  await runChunk(rdb, mkDeps(world.search, world.pages, world.ai), run_id, { batchEstimateMs: 0 });
  return run_id;
};

describe("getBrief", () => {
  it("before any run there is nothing to report — no invented movement", async () => {
    const b = await getBrief(db, TODAY);
    expect(b.run).toBeNull();
    expect(b.movers).toEqual([]);
    expect(b.newSignals).toEqual([]);
  });

  it("a first run has no movers from existing investors with a previous score; second run reports real deltas and only its own new signals", async () => {
    const u1 = "https://news.example/alpha-1";
    const u2 = "https://news.example/alpha-2";
    const r1 = await run({
      search: fakeSearch({ Alpha: [hit(u1, "Alpha", daysAgo(20))], Beta: [], Gamma: [] }),
      pages: fakePages({ [u1]: article("Alpha", daysAgo(20)) }),
      ai: fakeAi({ [u1]: { relevance: 45, confidence: "medium" } }),
    });
    const first = await getBrief(db, new Date(Date.UTC(2026, 9, 11)).toISOString().slice(0, 10));
    expect(first.run?.id).toBe(r1);
    expect(first.movers.every((m) => m.is_new)).toBe(true); // no earlier check ⇒ nothing can have "moved"

    const r2 = await run({
      search: fakeSearch({ Alpha: [hit(u2, "Alpha", daysAgo(1))], Beta: [], Gamma: [] }),
      pages: fakePages({ [u2]: article("Alpha", daysAgo(1)) }),
      ai: fakeAi({ [u2]: { relevance: 92, confidence: "high" } }),
    });
    const b = await getBrief(db, "2026-10-11");
    expect(b.run?.id).toBe(r2);
    expect(b.previous?.id).toBe(r1);
    const alpha = b.movers.find((m) => m.firm_name === "Alpha")!;
    expect(alpha.is_new).toBe(false);
    expect(alpha.delta).toBeGreaterThan(5);
    expect(alpha.prev_score).not.toBeNull();
    expect(b.newSignals.map((s) => s.url)).toEqual([u2]); // only what THIS run found
    expect(b.newSignals[0]).toMatchObject({ firm_name: "Alpha", relevance_score: 92, new_capital: false });
  });

  it("failures and partial coverage surface under 'attention', never under quiet", async () => {
    await run({ search: fakeSearch({ Alpha: [], Beta: new ProviderError("http_5xx", "down"), Gamma: [] }), pages: fakePages({}), ai: fakeAi() });
    const b = await getBrief(db, "2026-10-11");
    expect(b.attention.map((r) => r.firm_name)).toEqual(["Beta"]);
  });

  it("a run that processed nobody ('nothing due') is not used as the brief's run", async () => {
    await db.query(`insert into runs (trigger_type, status, completed_at, investors_total, summary) values ('cron', 'succeeded', now(), 0, 'Nothing due')`);
    expect((await getBrief(db, TODAY)).run).toBeNull();
  });
});

describe("getFunnel", () => {
  it("stages reconcile: found minus every drop equals what survived to the AI step", async () => {
    const good = "https://news.example/good";
    const other = "https://news.example/other";
    const old = "https://news.example/old";
    const prof = "https://www.crunchbase.com/organization/alpha";
    const id = await run({
      search: fakeSearch({ Alpha: [hit(good, "Alpha", daysAgo(2)), hit(other, "Someone Else", daysAgo(2)), hit(old, "Alpha", daysAgo(50)), hit(prof, "Alpha", daysAgo(2))], Beta: [], Gamma: [] }),
      pages: fakePages({ [good]: article("Alpha", daysAgo(2)), [other]: article("Someone Else", daysAgo(2)), [old]: article("Alpha", daysAgo(50)) }),
      ai: fakeAi(),
    });
    const f = await getFunnel(db, id);
    expect(f.total).toBe(4);
    const by = Object.fromEntries(f.stages.map((s) => [s.key, s]));
    expect(by.named!.dropped).toBe(1); // "Someone Else"
    expect(by.page!.dropped).toBe(1); // Crunchbase profile
    expect(by.date!.dropped).toBe(1); // 50 days old
    expect(f.stages.at(-1)!.count).toBe(1); // the one good candidate
    expect(f.relevant).toBe(1);
    // alive count is monotonically non-increasing
    for (let i = 1; i < f.stages.length; i++) expect(f.stages[i]!.count).toBeLessThanOrEqual(f.stages[i - 1]!.count);
  });
});

describe("getBudget", () => {
  it("sums this month's tracked search calls plus the baseline against the cap", async () => {
    await db.query(`insert into runs (trigger_type, status, completed_at, search_calls) values ('cron','succeeded', now(), 40), ('manual','succeeded', now(), 25)`);
    expect(await getBudget(db, 900, 70)).toEqual({ budget: 900, baseline: 70, tracked: 65, spent: 135, remaining: 765, pct: 15 });
    expect((await getBudget(db, 100, 70)).remaining).toBe(0);
  });
});
