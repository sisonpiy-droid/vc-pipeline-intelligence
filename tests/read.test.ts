import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { deriveState, displayStatus, filterPipeline, getInvestor, getOverview, listPipeline, listSignals, priorityOf, sectorOptions, stageBucket, type StateInputs } from "@/lib/read";
import { runChunk, startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";
import { CRON_SCHEDULE, nextScheduledRun } from "@/lib/schedule";
import { ProviderError } from "@/lib/providers/types";
import { article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps, NOW } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

const TODAY = "2026-10-11";

describe("deriveState — failed or partial retrieval is never read as 'quiet'", () => {
  const base: StateInputs = { relevant_30d: 0, has_item: true, latest_failed: false, partial: false, last_relevant: null };
  it.each<[string, Partial<StateInputs>, string]>([
    ["relevant signal in window", { relevant_30d: 2 }, "active"],
    ["relevant signal wins even if the latest refresh failed", { relevant_30d: 1, latest_failed: true }, "active"],
    ["latest refresh failed, nothing known", { latest_failed: true }, "failed"],
    ["never refreshed", { has_item: false }, "not_checked"],
    ["nothing found but a source failed", { partial: true }, "quiet_partial"],
    ["partial beats stale", { partial: true, last_relevant: "2026-08-01" }, "quiet_partial"],
    ["older relevant signals only", { last_relevant: "2026-08-01" }, "stale"],
    ["signal exactly 30 days old is still in window → not stale", { last_relevant: "2026-09-11" }, "quiet_complete"],
    ["clean search, nothing", {}, "quiet_complete"],
  ])("%s → %s", (_n, over, expected) => expect(deriveState({ ...base, ...over }, TODAY)).toBe(expected));

  it("maps to the four statuses the UI shows", () => {
    expect(displayStatus("active")).toBe("active");
    expect(displayStatus("failed")).toBe("failed");
    expect(displayStatus("quiet_partial")).toBe("review");
    expect(displayStatus("not_checked")).toBe("review");
    expect(displayStatus("stale")).toBe("quiet");
    expect(displayStatus("quiet_complete")).toBe("quiet");
  });
});

describe("helpers", () => {
  it("priority buckets", () => {
    expect([null, 20, 54, 55, 74, 75, 99].map(priorityOf)).toEqual(["unscored", "low", "low", "medium", "medium", "high", "high"]);
  });
  it("stage buckets agree with the scoring engine's reading", () => {
    expect(stageBucket("Pre-seed / seed")).toBe("seed");
    expect(stageBucket("Early stage")).toBe("early");
    expect(stageBucket("Growth / early growth")).toBe("growth");
    expect(stageBucket(null)).toBe("unknown");
  });
  it("next scheduled run is the next Mon/Thu 04:00 UTC after now", () => {
    expect(nextScheduledRun(new Date("2026-10-11T12:00:00Z")).toISOString()).toBe("2026-10-12T04:00:00.000Z"); // Sun → Mon
    expect(nextScheduledRun(new Date("2026-10-12T03:59:00Z")).toISOString()).toBe("2026-10-12T04:00:00.000Z");
    expect(nextScheduledRun(new Date("2026-10-12T04:00:00Z")).toISOString()).toBe("2026-10-15T04:00:00.000Z"); // Mon → Thu
    expect(nextScheduledRun(new Date("2026-10-15T05:00:00Z")).toISOString()).toBe("2026-10-19T04:00:00.000Z"); // Thu → Mon
  });
  it("vercel.json schedules exactly what the dashboard says it does", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(cfg.crons).toEqual([{ path: "/api/cron/refresh", schedule: CRON_SCHEDULE }]);
  });
});

describe("read model over data written by the real pipeline", () => {
  let db: Db;
  const ids: Record<string, string> = {};
  const add = async (name: string, extra: Record<string, unknown> = {}) => {
    const cols = { entity_type: "vc_firm", name_key: name.toLowerCase(), firm_name: name, website_url: `https://${name.toLowerCase()}.vc`, stage_preference: "Seed", sectors: ["Logistics"], geography: "India", ...extra };
    const k = Object.keys(cols);
    ids[name] = (await db.query<{ id: string }>(`insert into investors (${k.join(",")}) values (${k.map((_, i) => `$${i + 1}`).join(",")}) returning id`, k.map((x) => cols[x as keyof typeof cols]))).rows[0]!.id;
  };

  beforeAll(async () => {
    db = await makeTestDb();
    for (const n of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]) await add(n);
    await add("Zeta", { entity_type: "angel", stage_preference: "Growth", sectors: ["consumer"] });
    // Delta: an old relevant verified signal (45 days ago) → "stale" after a clean search.
    await db.query(
      `insert into signals (investor_id, url, canonical_url, headline, published_at, verification_status, relevance_score, evidence_confidence, signal_type, summary)
       values ($1,'https://old.example/d','https://old.example/d','Delta old news',$2,'verified',90,'high','article','Old')`,
      [ids.Delta, daysAgo(45)],
    );
    const u = "https://news.example/alpha";
    const eps = "https://news.example/epsilon";
    const zet = "https://news.example/zeta";
    const search = fakeSearch({
      Alpha: [hit(u, "Alpha", daysAgo(3))], Beta: [], Gamma: new ProviderError("http_5xx", "down"), Delta: [],
      Epsilon: [{ ...hit(eps, "Epsilon", daysAgo(2)), snippet: "Epsilon note." }], Zeta: [hit(zet, "Zeta", daysAgo(2))],
    });
    const pages = fakePages({ [u]: article("Alpha", daysAgo(3)), [eps]: new ProviderError("http_5xx", "origin down"), [zet]: article("Zeta", daysAgo(2)) });
    const rdb = asRefresh(db);
    const { run_id } = await startRun(rdb, "manual");
    await runChunk(rdb, mkDeps(search, pages, fakeAi({ [zet]: { relevance: 10 } })), run_id, { batchEstimateMs: 0 });
    // Eta: added after the run → never checked.
    await add("Eta");
  });
  afterAll(() => db.close());

  it("derives each investor's state from what the pipeline actually recorded", async () => {
    const rows = await listPipeline(db, TODAY);
    const st = Object.fromEntries(rows.map((r) => [r.firm_name, r.state]));
    expect(st).toEqual({ Alpha: "active", Beta: "quiet_complete", Gamma: "failed", Delta: "stale", Epsilon: "quiet_partial", Zeta: "quiet_complete", Eta: "not_checked" });
    const alpha = rows.find((r) => r.firm_name === "Alpha")!;
    expect(alpha.lead).toMatchObject({ url: u0(), published_at: daysAgo(3), signal_type: "portfolio_investment" });
    expect(alpha.lead!.why).toBeTruthy();
    expect(alpha.explanation).toMatch(/Score \d+\/100/);
    expect(rows.find((r) => r.firm_name === "Gamma")!.follow_up_score).toBeNull(); // failure ≠ score 0
  });

  it("overview counts partition the tracked investors exactly", async () => {
    const o = await getOverview(db, TODAY);
    expect(o.counts).toEqual({ total: 7, active: 1, quiet: 3, review: 2, failed: 1 });
    expect(o.counts.active + o.counts.quiet + o.counts.review + o.counts.failed).toBe(o.counts.total);
    expect(o.lastGood?.status).toBe("partial");
  });

  it("filters and sorts", async () => {
    const rows = await listPipeline(db, TODAY);
    const names = (f: object) => filterPipeline(rows, f, TODAY).map((r) => r.firm_name);
    expect(names({ state: "failed" })).toEqual(["Gamma"]);
    expect(names({ state: "active" })).toEqual(["Alpha"]);
    expect(names({ entity: "angel" })).toEqual(["Zeta"]);
    expect(names({ q: "alp" })).toEqual(["Alpha"]);
    expect(names({ category: "portfolio_investment" })).toEqual(["Alpha"]);
    expect(names({ freshness: "7" })).toEqual(["Alpha"]);
    expect(names({ freshness: "none" })).toContain("Beta");
    expect(names({ freshness: "none" })).not.toContain("Alpha");
    expect(names({ priority: "high" })).toEqual(["Alpha"]);
    expect(names({ sector: "LOGISTICS" })).not.toContain("Zeta");
    expect(names({ stage: "growth" })).toEqual(["Zeta"]);
    expect(names({ relationship: "not_contacted" })).toHaveLength(7);
    expect(names({})[0]).toBe("Alpha"); // default: highest score first
    expect(names({ sort: "name" })).toEqual(["Alpha", "Beta", "Delta", "Epsilon", "Eta", "Gamma", "Zeta"]);
    expect(sectorOptions(rows)[0]).toBe("logistics");
  });

  it("signals feed: relevant by default, needs-review on request, never leaks rejected rows, carries provenance", async () => {
    const feed = await listSignals(db, TODAY);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ firm_name: "Alpha", published_at: daysAgo(3), source_name: "news.example", verification_status: "verified", duplicates: 0 });
    expect(feed[0]!.retrieved_at).toBeTruthy();
    expect(feed[0]!.evidence_excerpt).toBeTruthy();
    // Zeta's irrelevant (relevance 10) verified signal appears only under "all verified".
    expect((await listSignals(db, TODAY, { show: "verified" })).map((s) => s.firm_name).sort()).toEqual(["Alpha", "Zeta"]);
    expect(await listSignals(db, TODAY, { show: "review" })).toEqual([]);
    expect(await listSignals(db, TODAY, { category: "article" })).toEqual([]);
    expect((await listSignals(db, TODAY, { investor: ids.Alpha })).length).toBe(1);
  });

  it("investor detail exposes notes read-only, the score breakdown, signals and coverage", async () => {
    const d = (await getInvestor(db, ids.Alpha!, TODAY))!;
    expect(d.state).toBe("active");
    expect(d.latest?.outcome?.breakdown.recency.max).toBe(30);
    expect(d.signals.length).toBeGreaterThan(0);
    expect(d.coverage.map((c) => c.source)).toEqual(expect.arrayContaining(["fake_search", "gemini_analysis", "page_fetch"]));
    expect(d.inv).toHaveProperty("personal_notes");
    expect(d.inv).toHaveProperty("contact_history");
    expect(await getInvestor(db, "00000000-0000-0000-0000-000000000000", TODAY)).toBeNull();
  });
});

const u0 = () => "https://news.example/alpha";
void NOW;
