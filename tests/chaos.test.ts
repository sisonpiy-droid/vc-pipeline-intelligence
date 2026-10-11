import { beforeAll, describe, expect, it } from "vitest";
import { baseline, runChaos } from "./helpers/chaos";

const N = 24;
let expected: Awaited<ReturnType<typeof baseline>>;
beforeAll(async () => { expected = await baseline(N); }, 60_000);

describe("fault injection: random failures in every dependency, a crashed invocation, then recovery", () => {
  for (const [seed, rate] of [[1, 0.15], [2, 0.3], [3, 0.45], [4, 0.6]] as const) {
    it(`seed ${seed}, fault rate ${Math.round(rate * 100)}%: every invariant holds and recovery converges to the fault-free result`, async () => {
      const r = await runChaos({ seed, rate, investors: N }, expected);
      const broken = r.invariants.filter((i) => !i.ok);
      expect(broken, JSON.stringify(broken, null, 1)).toEqual([]);
      expect(Object.values(r.injected).reduce((a, b) => a + b, 0)).toBeGreaterThan(0); // faults really were injected
    }, 120_000);
  }

  it("the fault-free baseline has real content to lose (some investors scored, some quiet)", () => {
    const scored = [...expected.values()].filter((v) => (v.score ?? 0) > 20).length;
    expect(scored).toBeGreaterThan(3);
    expect(scored).toBeLessThan(N);
  });
});

// ── two failure-recovery bugs found by this fault injection, pinned as plain regression tests ──
import { afterAll, beforeEach } from "vitest";
import type { Db } from "@/lib/db";
import { ProviderError } from "@/lib/providers/types";
import { runChunk, startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";
import { article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

describe("a transient page failure is never turned into a permanent verdict", () => {
  let db: Db;
  let rdb: Db;
  const u = "https://news.example/alpha";
  beforeAll(async () => { db = await makeTestDb(); rdb = asRefresh(db); });
  afterAll(() => db.close());
  beforeEach(async () => {
    await db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs, score_history restart identity cascade");
    await db.query(`insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography) values ('vc_firm', 'alpha', 'Alpha', 'https://alpha.vc', 'Seed', '{Logistics}', 'India')`);
  });
  const run = async (pageReply: string | ProviderError, search = [hit(u, "Alpha", daysAgo(2))]) => {
    const { run_id } = await startRun(rdb, "manual");
    await runChunk(rdb, mkDeps(fakeSearch({ Alpha: search }), fakePages({ [u]: pageReply }), fakeAi()), run_id, { batchEstimateMs: 0 });
  };
  const sig = async () => (await db.query(`select verification_status v, rejection_reason r, evidence_confidence c, provisional p from signals`)).rows[0] as { v: string; r: string | null; c: string | null; p: boolean };
  const score = async () => ((await db.query(`select follow_up_score s from investors`)).rows[0] as { s: number }).s;

  it("evidence judged from a snippet because the fetch timed out is provisional, and the next run re-judges it at full confidence", async () => {
    await run(new ProviderError("timeout", "slow"));
    expect(await sig()).toMatchObject({ v: "verified", c: "medium", p: true }); // confidence capped, marked provisional
    const low = await score();
    await run(article("Alpha", daysAgo(2)));
    expect(await sig()).toMatchObject({ v: "verified", c: "high", p: false });
    expect(await score()).toBeGreaterThan(low);
  });

  it("a robots/404 failure is permanent, so it is NOT retried forever (no wasted calls each run)", async () => {
    await run(new ProviderError("blocked", "robots.txt disallows"));
    expect(await sig()).toMatchObject({ v: "verified", p: false });
  });

  it("an undated candidate whose page could not be read is 'needs review' and retried, not rejected for good", async () => {
    await run(new ProviderError("http_5xx", "origin down"), [{ ...hit(u, "Alpha", null) }]);
    expect(await sig()).toMatchObject({ v: "needs_review", r: "page_unavailable" });
    await run(article("Alpha", daysAgo(2)), [{ ...hit(u, "Alpha", null) }]);
    expect(await sig()).toMatchObject({ v: "verified", p: false });
  });
});
