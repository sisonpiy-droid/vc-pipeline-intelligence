import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { planRun } from "@/lib/refresh/plan";
import { runChunk, startRun } from "@/lib/refresh/run";
import { planFromEnv } from "@/lib/refresh/service";
import { asRefresh } from "@/lib/refresh/write";
import { article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps, NOW } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

let db: Db;
let rdb: Db;
const ids: Record<string, string> = {};
const HOUR = 3_600_000;
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString();

async function add(name: string, score: number | null = null) {
  ids[name] = (await db.query<{ id: string }>(
    `insert into investors (entity_type, name_key, firm_name, follow_up_score) values ('vc_firm', $1, $2, $3) returning id`,
    [name.toLowerCase(), name, score],
  )).rows[0]!.id;
}
/** A completed check of `name`, `hoursAgo` hours before NOW, that found `relevant` relevant signals. */
async function checked(name: string, hoursAgo: number, relevant: number, status: "done" | "failed" = "done") {
  const run = (await db.query<{ id: string }>(`insert into runs (trigger_type, status, completed_at) values ('cron', 'succeeded', now()) returning id`)).rows[0]!.id;
  await db.query(
    `insert into run_items (run_id, investor_id, status, finished_at, outcome) values ($1, $2, $3, $4, $5::jsonb)`,
    [run, ids[name], status, ago(hoursAgo), JSON.stringify({ relevant_signals: relevant })],
  );
}
const plan = (o = {}) => planRun(db, { now: NOW, ...o });
const names = (p: { ids: string[] }) => p.ids.map((id) => Object.keys(ids).find((k) => ids[k] === id)!);

beforeAll(async () => {
  db = await makeTestDb();
  rdb = asRefresh(db);
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs restart identity cascade");
  for (const n of Object.keys(ids)) delete ids[n];
});

describe("planRun — spend free-tier search credits where they matter", () => {
  it("never-checked investors are always due", async () => {
    await add("A");
    await add("B");
    expect((await plan()).ids).toHaveLength(2);
  });

  it("skips investors checked recently (so a manual run right after the cron run costs nothing)", async () => {
    await add("Fresh");
    await add("Old");
    await checked("Fresh", 1, 2);
    await checked("Old", 40, 2);
    const p = await plan();
    expect(names(p)).toEqual(["Old"]);
    expect(p.skipped.recent).toBe(1);
  });

  it("a FAILED last check is retried even if it was recent — a failure is not a result", async () => {
    await add("Failed");
    await checked("Failed", 1, 0, "failed");
    expect(names(await plan())).toEqual(["Failed"]);
  });

  it("cold investors (two empty checks in a row) are searched about weekly, not every run", async () => {
    await add("Cold3d");
    await add("Cold8d");
    await add("OneEmpty");
    for (const h of [72, 150]) await checked("Cold3d", h, 0);
    for (const h of [8 * 24, 11 * 24]) await checked("Cold8d", h, 0);
    await checked("OneEmpty", 72, 0); // only one clean check so far: not yet "cold"
    const p = await plan();
    expect(names(p).sort()).toEqual(["Cold8d", "OneEmpty"]);
    expect(p.skipped.cold).toBe(1);
  });

  it("an investor with a relevant signal on their last check is never treated as cold", async () => {
    await add("Hot");
    await checked("Hot", 80, 3);
    await checked("Hot", 150, 0);
    expect(names(await plan())).toEqual(["Hot"]);
  });

  it("skipping can be disabled", async () => {
    await add("Fresh");
    await checked("Fresh", 1, 0);
    expect((await plan({ recentHours: 0, coldDays: 0 })).ids).toHaveLength(1);
  });

  describe("monthly credit budget", () => {
    beforeEach(async () => {
      await add("Active-high", 90);
      await add("Active-low", 60);
      await add("Failed");
      await add("Never");
      await add("Stale");
      await checked("Active-high", 80, 2);
      await checked("Active-low", 80, 1);
      await checked("Failed", 80, 0, "failed");
      await checked("Stale", 200, 0);
    });

    it("spends credits on the most valuable investors first: active (best score), then retries, then never-checked, then stalest", async () => {
      expect(names(await plan({ creditBudget: 100 }))).toEqual(["Active-high", "Active-low", "Failed", "Never", "Stale"]);
      expect(names(await plan({ creditBudget: 3 }))).toEqual(["Active-high", "Active-low", "Failed"]);
    });

    it("exhaustion skips investors explicitly — and reports how many", async () => {
      const p = await plan({ creditBudget: 2 });
      expect(p.ids).toHaveLength(2);
      expect(p.skipped.budget).toBe(3);
      expect(p.cost).toBe(2);
    });

    it("LinkedIn doubles the per-investor cost", async () => {
      const p = await plan({ creditBudget: 5, linkedin: true });
      expect(p.ids).toHaveLength(2);
      expect(p.cost).toBe(4);
    });

    it("credits already spent this month (and the baseline) reduce what is left", async () => {
      await db.query(`insert into runs (trigger_type, status, completed_at, search_calls) values ('cron', 'succeeded', now(), 4)`);
      const p = await plan({ creditBudget: 10, creditsBaseline: 3 });
      expect(p.remaining).toBe(3);
      expect(p.ids).toHaveLength(3);
    });

    it("zero credits left ⇒ nobody is searched (and nothing is reported as a failure)", async () => {
      const p = await plan({ creditBudget: 0 });
      expect(p.ids).toEqual([]);
      expect(p.remaining).toBe(0);
    });

    it("no budget means no cap", async () => expect((await plan()).ids).toHaveLength(5));
  });
});

describe("startRun with a plan", () => {
  it("creates run_items only for due investors; skipped ones are untouched, not marked anything", async () => {
    await add("Due");
    await add("Recent");
    await checked("Recent", 2, 1);
    const { run_id, state } = await startRun(rdb, "cron", { now: NOW, recentHours: 36 });
    expect(state).toBe("started");
    const items = (await db.query(`select investor_id from run_items where run_id=$1`, [run_id])).rows;
    expect(items).toEqual([{ investor_id: ids.Due }]);
    const run = (await db.query(`select investors_total, skipped, plan, include_linkedin from runs where id=$1`, [run_id])).rows[0] as Record<string, unknown>;
    expect(run).toMatchObject({ investors_total: 1, skipped: 1, include_linkedin: false });
    expect(run.plan).toMatchObject({ recent: 1, cold: 0, budget: 0, expected_searches: 1 });
  });

  it("when nothing is due the run completes immediately, uses no credits, and says why", async () => {
    await add("Recent");
    await checked("Recent", 1, 1);
    const { run_id, state } = await startRun(rdb, "manual", { now: NOW });
    expect(state).toBe("nothing_due");
    const run = (await db.query(`select status, search_calls, completed_at, summary from runs where id=$1`, [run_id])).rows[0] as Record<string, unknown>;
    expect(run).toMatchObject({ status: "succeeded", search_calls: 0 });
    expect(run.completed_at).not.toBeNull();
    expect(String(run.summary)).toMatch(/Nothing due/);
    // and the unique-active-run lock is free again
    expect((await startRun(rdb, "manual")).state).toBe("started");
  });

  it("planFromEnv defaults are free-tier safe and overridable", () => {
    const saved = { ...process.env };
    delete process.env.TAVILY_MONTHLY_BUDGET;
    delete process.env.TAVILY_CREDITS_BASELINE;
    expect(planFromEnv()).toMatchObject({ creditBudget: 900, creditsBaseline: 0, linkedin: false, recentHours: 36, coldDays: 6.5 });
    process.env.TAVILY_MONTHLY_BUDGET = "500";
    process.env.TAVILY_CREDITS_BASELINE = "70";
    expect(planFromEnv({ linkedin: true })).toMatchObject({ creditBudget: 500, creditsBaseline: 70, linkedin: true });
    Object.assign(process.env, saved);
  });
});

describe("search-call accounting", () => {
  const world = (names: string[]) => {
    const u = "https://news.example/a";
    return mkDeps(fakeSearch(Object.fromEntries(names.map((n) => [n, n === "A" ? [hit(u, "A", daysAgo(3))] : []]))), fakePages({ [u]: article("A", daysAgo(3)) }), fakeAi());
  };

  it("counts one metered call per investor, two when LinkedIn is on — and the run's own flag decides", async () => {
    await add("A");
    await add("B");
    const first = await startRun(rdb, "manual", { now: NOW, recentHours: 0, coldDays: 0 });
    await runChunk(rdb, world(["A", "B"]), first.run_id, { batchEstimateMs: 0 });
    expect((await db.query(`select search_calls from runs where id=$1`, [first.run_id])).rows[0]).toEqual({ search_calls: 2 });

    // LinkedIn requested at start ⇒ the chunk (given deps with no explicit linkedin) searches it: 2 per investor
    const second = await startRun(rdb, "manual", { now: NOW, recentHours: 0, coldDays: 0, linkedin: true });
    await runChunk(rdb, world(["A", "B"]), second.run_id, { batchEstimateMs: 0 });
    expect((await db.query(`select search_calls, include_linkedin from runs where id=$1`, [second.run_id])).rows[0]).toEqual({ search_calls: 4, include_linkedin: true });
    expect((await db.query(`select 1 from source_coverage where source='fake_linkedin_search'`)).rowCount).toBe(2);
  });

  it("failed search calls still count — the provider may bill them", async () => {
    await add("A");
    const { ProviderError } = await import("@/lib/providers/types");
    const deps = mkDeps(fakeSearch({ A: new ProviderError("http_5xx", "down") }), fakePages({}), fakeAi());
    const { run_id } = await startRun(rdb, "manual");
    await runChunk(rdb, deps, run_id, { batchEstimateMs: 0 });
    expect(((await db.query(`select search_calls from runs where id=$1`, [run_id])).rows[0] as { search_calls: number }).search_calls).toBe(3); // 3 attempts at the item level
  });
});
