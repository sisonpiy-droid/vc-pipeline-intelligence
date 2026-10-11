import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { DEFAULT_CONFIG, scoreInvestor } from "@/lib/scoring/score";
import { buildConfig, DEFAULT_CONTROLS, getSimulationInputs, PRESETS } from "@/lib/simulate";
import { runChunk, startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";
import { NOW, article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

describe("buildConfig", () => {
  it("the default controls reproduce the production config exactly", () => {
    expect(buildConfig(DEFAULT_CONTROLS)).toEqual(DEFAULT_CONFIG);
  });

  it("weights are rescaled to sum to 100 whatever the sliders say; all-zero falls back to the defaults", () => {
    const c = buildConfig({ ...DEFAULT_CONTROLS, weights: { recency: 10, relevance: 10, evidence: 10, fit: 10, relationship: 10 } });
    expect(Object.values(c.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    expect(buildConfig({ ...DEFAULT_CONTROLS, weights: { recency: 0, relevance: 0, evidence: 0, fit: 0, relationship: 0 } }).weights).toEqual(DEFAULT_CONFIG.weights);
  });

  it("the 'prepare' threshold can never reach the 'reach out' threshold", () => {
    expect(buildConfig({ ...DEFAULT_CONTROLS, reachOutNow: 60, prepareOutreach: 80 }).thresholds).toEqual({ reachOutNow: 60, prepareOutreach: 59 });
  });

  it("every preset is a valid configuration", () => {
    for (const p of PRESETS) {
      const w = Object.values(buildConfig(p.controls).weights);
      expect(w.every((x) => x >= 0)).toBe(true);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    }
  });
});

describe("getSimulationInputs", () => {
  let db: Db;
  const u = "https://news.example/alpha";
  beforeAll(async () => {
    db = await makeTestDb();
    for (const n of ["Alpha", "Beta"]) await db.query(`insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography, personal_notes) values ('vc_firm', $1, $2, 'https://x.vc', 'Seed', '{Logistics}', 'India', 'PRIVATE')`, [n.toLowerCase(), n.charAt(0).toUpperCase() + n.slice(1)]);
    const rdb = asRefresh(db);
    const deps = mkDeps(fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(2))], Beta: [] }), fakePages({ [u]: article("Alpha", daysAgo(2)) }), fakeAi());
    const { run_id } = await startRun(rdb, "manual", { recentHours: 0, coldDays: 0 });
    await runChunk(rdb, deps, run_id, { batchEstimateMs: 0 });
    await db.query(`insert into investors (entity_type, name_key, firm_name) values ('vc_firm', 'delta', 'Delta')`); // never checked
  });
  afterAll(() => db.close());

  it("includes checked investors only, with the evidence needed to re-score, and never private notes", async () => {
    const sim = await getSimulationInputs(db);
    expect(sim.map((s) => s.firm_name).sort()).toEqual(["Alpha", "Beta"]);
    expect(JSON.stringify(sim)).not.toMatch(/PRIVATE/);
    const alpha = sim.find((s) => s.firm_name === "Alpha")!;
    expect(alpha.input.signals).toHaveLength(1);
    expect(alpha.input.signals[0]).toMatchObject({ sector_match: "logistics", relevance: 85 });
  });

  it("re-scoring the inputs with the default config reproduces the stored production score and action", async () => {
    const alpha = (await getSimulationInputs(db)).find((s) => s.firm_name === "Alpha")!;
    const r = scoreInvestor({ ...alpha.input, now: NOW, config: buildConfig(DEFAULT_CONTROLS) });
    expect({ score: r.score, action: r.action }).toEqual({ score: alpha.stored_score, action: alpha.stored_action });
  });
});
