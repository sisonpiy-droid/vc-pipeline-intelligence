import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiError } from "@/lib/ai/gemini";
import type { Db } from "@/lib/db";
import { runChunk, startRun } from "@/lib/refresh/run";
import { getProviderHealth, instrument, type CallRecord } from "@/lib/refresh/telemetry";
import { asRefresh } from "@/lib/refresh/write";
import { ProviderError } from "@/lib/providers/types";
import { article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

describe("instrument", () => {
  it("records provider, outcome, error category and duration without changing results or errors", async () => {
    const calls: CallRecord[] = [];
    const deps = instrument(
      mkDeps(fakeSearch({ Alpha: [hit("https://n.example/a", "Alpha")], Beta: new ProviderError("rate_limited", "429") }), fakePages({}), fakeAi({}, "down")),
      (r) => calls.push(r),
    );
    expect(await deps.search.search({ query: "Alpha x", startDate: "2026-09-01", endDate: "2026-10-11", maxResults: 5 })).toHaveLength(1);
    await expect(deps.search.search({ query: "Beta x", startDate: "2026-09-01", endDate: "2026-10-11", maxResults: 5 })).rejects.toThrow("429");
    await expect(deps.pages.fetch("https://missing.example")).rejects.toThrow();
    await expect(deps.ai.generateJson({ system: "s", prompt: "p", responseSchema: {} })).rejects.toBeInstanceOf(AiError);
    expect(calls.map((c) => [c.provider, c.ok, c.category])).toEqual([["fake", true, null], ["fake", false, "rate_limited"], ["page_fetch", false, "http_4xx"], ["gemini", false, "unavailable"]]);
    expect(calls.every((c) => c.ms >= 0)).toBe(true);
    expect(deps.search.name).toBe("fake");
  });
});

describe("provider health in a real run", () => {
  let db: Db;
  beforeAll(async () => { db = await makeTestDb(); });
  afterAll(() => db.close());

  it("a refresh records every search, page fetch and Gemini call, and health summarises them", async () => {
    const rdb = asRefresh(db);
    await db.query(`insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography) values ('vc_firm', 'alpha', 'Alpha', 'https://alpha.vc', 'Seed', '{Logistics}', 'India'), ('vc_firm', 'beta', 'Beta', 'https://beta.vc', 'Seed', '{Logistics}', 'India')`);
    const u = "https://news.example/a";
    const deps = mkDeps(fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(2))], Beta: new ProviderError("http_5xx", "down") }), fakePages({ [u]: article("Alpha", daysAgo(2)) }), fakeAi());
    const { run_id } = await startRun(rdb, "manual");
    await runChunk(rdb, deps, run_id, { batchEstimateMs: 0 });
    const health = await getProviderHealth(db, 7);
    const by = Object.fromEntries(health.map((h) => [h.provider, h]));
    expect(by.fake).toMatchObject({ failed: 3 }); // Beta's search failed on all 3 attempts
    expect(by.fake!.calls).toBe(4);
    expect(by.fake!.top_errors).toEqual([{ category: "http_5xx", n: 3 }]);
    expect(by.page_fetch).toMatchObject({ calls: 1, failed: 0 });
    expect(by.gemini!.calls).toBeGreaterThanOrEqual(3); // analysis + review + angle
    expect(by.gemini!.p95_ms).toBeGreaterThanOrEqual(by.gemini!.p50_ms);
  });

  it("is best effort: a broken telemetry table never fails an investor", async () => {
    const rdb = asRefresh(db);
    await db.exec("truncate runs, run_items, signals, source_coverage, audit_logs, score_history, provider_calls restart identity cascade");
    await db.exec("alter table provider_calls rename to provider_calls_x");
    try {
      const u = "https://news.example/a";
      const deps = mkDeps(fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(2))], Beta: [] }), fakePages({ [u]: article("Alpha", daysAgo(2)) }), fakeAi());
      const { run_id } = await startRun(rdb, "manual");
      const r = await runChunk(rdb, deps, run_id, { batchEstimateMs: 0 });
      expect(r.status).toBe("succeeded");
    } finally {
      await db.exec("alter table provider_calls_x rename to provider_calls");
    }
  });
});
