import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiError, type AiClient, type AiRequest } from "@/lib/ai/gemini";
import type { Db } from "@/lib/db";
import { fitFactors } from "@/lib/scoring/score";
import { generateRubric } from "@/lib/startups/generate";
import { evaluateStartup, rescoreStartup } from "@/lib/startups/evaluate";
import { defaultRubric, ProfileSchema, rubricToConfig, sanitizeRubric, slugify, type StartupProfile } from "@/lib/startups/rubric";
import { createStartup, getStartup, getSteps, saveRubric } from "@/lib/startups/store";
import { NOW, daysAgo } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

const fintech: StartupProfile = ProfileSchema.parse({ name: "Ledgerly", pitch: "Payments infrastructure that lets Indian SMEs reconcile invoices automatically.", sector: "B2B payments infrastructure", stage: "seed", geography: "India" });
const logistics: StartupProfile = ProfileSchema.parse({ name: "Haulr", pitch: "Freight marketplace software for trucking fleets.", sector: "B2B logistics SaaS", stage: "seed", geography: "India" });

/** A model double that judges by keyword: an item scores high only when it mentions the startup's own market. */
function judgeAi(counter: { calls: number } = { calls: 0 }, fail?: AiError): AiClient & { calls: number } {
  return {
    get calls() { return counter.calls; },
    async generateJson(req: AiRequest) {
      counter.calls++;
      if (fail) throw fail;
      const market = /payments/i.test(req.system) ? /payment|invoice|fintech/i : /freight|truck|logistic/i;
      const items = [...req.prompt.matchAll(/<item index="(\d+)"[^>]*>\n([\s\S]*?)<\/item>/g)];
      return { judgements: items.map((m) => ({ index: Number(m[1]), relevance: market.test(m[2]!) ? 90 : 10, sector_match: market.test(m[2]!) ? "logistics" : "adjacent", note: "" })) };
    },
  };
}

let db: Db;
beforeAll(async () => { db = await makeTestDb(); });
afterAll(() => db.close());

async function seed() {
  await db.exec("truncate investors, runs, run_items, signals, startups restart identity cascade");
  const mk = async (key: string, firm: string, o: { demo?: boolean; searched?: boolean; notes?: string } = {}) => {
    const id = (await db.query<{ id: string }>(
      `insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography, personal_notes, relationship_status, is_demo)
       values ('vc_firm', $1, $2, 'https://x.vc', 'Seed', '{Logistics,Fintech}', 'India', $3, 'passed', $4) returning id`, [key, firm, o.notes ?? "PRIVATE NOTE", o.demo ?? false])).rows[0]!.id;
    if (o.searched !== false) {
      const run = (await db.query<{ id: string }>(`insert into runs (trigger_type, status) values ('manual', 'succeeded') returning id`)).rows[0]!.id;
      await db.query(`insert into run_items (run_id, investor_id, status, finished_at, outcome) values ($1, $2, 'done', now(), '{"coverage":"complete"}')`, [run, id]);
    }
    return id;
  };
  const sig = (inv: string, url: string, headline: string, days: number, extra = "") =>
    db.query(`insert into signals (investor_id, url, canonical_url, headline, source_name, published_at, signal_type, evidence_excerpt, summary, relevance_score, evidence_confidence, verification_status, sector_match ${extra ? "," + extra.split("=")[0] : ""})
              values ($1, $2, $2, $3, 'news.example', $4, 'portfolio_investment', $3, $3, 99, 'high', 'verified', 'logistics' ${extra ? "," + extra.split("=")[1] : ""})`, [inv, url, headline, daysAgo(days)]);
  const a = await mk("alpha", "Alpha Freight Capital");
  const b = await mk("beta", "Beta Payments Partners");
  const c = await mk("gamma", "Gamma Silent");
  const never = await mk("delta", "Delta Unsearched", { searched: false });
  const demo = await mk("demo1", "Piyush demo", { demo: true });
  await sig(a, "https://news.example/a", "Alpha Freight Capital leads seed round in a freight marketplace for trucking fleets", 2);
  await sig(b, "https://news.example/b", "Beta Payments Partners backs invoice payments startup at seed", 3);
  await sig(never, "https://news.example/d", "Delta backs a freight startup", 1);
  await sig(demo, "https://news.example/x", "Demo freight signal", 1);
  return { a, b, c, never, demo };
}

const startup = async (p: StartupProfile) => createStartup(db, p, { rubric: defaultRubric(p), source: "default", note: null });
const scoreOf = async (slug: string, firm: string) =>
  (await db.query<{ score: number; action: string; coverage: string }>(
    `select s.score, s.action, s.coverage from startup_scores s join investors i on i.id = s.investor_id join startups t on t.id = s.startup_id where t.slug = $1 and i.firm_name = $2`, [slug, firm])).rows[0];

describe("rubric safety", () => {
  it("sanitizeRubric clamps hostile numbers, rescales weights to 100, orders thresholds and caps", () => {
    const base = defaultRubric(fintech);
    const r = sanitizeRubric({
      ...base,
      weights: { recency: 5000, relevance: -3, evidence: 20, fit: 15, relationship: 5 },
      thresholds: { reachOutNow: 5, prepareOutreach: 99 },
      reachOutMinRelevance: 1000,
      sectorCap: { logistics: 5, b2b_software: 10, seed_generalist: 100, adjacent: 100, unrelated: 100 },
      fit: { ...base.fit, coreTerms: ["  Payments ", "payments", "", "x".repeat(200)] },
    }, base);
    expect(Object.values(r.weights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.max(...Object.values(r.weights))).toBeLessThanOrEqual(60);
    expect(r.thresholds.reachOutNow).toBeGreaterThanOrEqual(60);
    expect(r.thresholds.prepareOutreach).toBeLessThanOrEqual(r.thresholds.reachOutNow - 5);
    expect(r.reachOutMinRelevance).toBe(80);
    expect(r.sectorCap.logistics).toBe(100);
    expect(r.sectorCap.unrelated).toBeLessThanOrEqual(r.sectorCap.adjacent);
    expect(r.sectorCap.adjacent).toBeLessThanOrEqual(r.sectorCap.b2b_software);
    expect(r.fit.coreTerms).toEqual(["payments"]);
  });

  it("garbage input falls back to the base rubric entirely", () => {
    const base = defaultRubric(logistics);
    expect(sanitizeRubric("nonsense", base)).toEqual(sanitizeRubric({}, base));
    expect(sanitizeRubric(null, base).weights).toEqual(base.weights);
  });

  it("the default rubric is a complete, valid config built from the profile (stage, geography, keywords)", () => {
    const r = defaultRubric({ ...fintech, stage: "series_a", geography: "Global" });
    expect(r.fit.stageBest).toContain("series a");
    expect(r.fit.geographyTerms).toEqual([]);
    expect(r.fit.coreTerms).toEqual(expect.arrayContaining(["payments", "infrastructure"]));
    expect(rubricToConfig(r).market?.sector).toBe("B2B payments infrastructure");
  });

  it("fit uses the startup's own terms: a payments investor fits a payments startup, not a logistics one", () => {
    const profile = { stage_preference: "Seed", sectors: ["Payments"], geography: "India", thesis_text: null };
    expect(fitFactors(profile, defaultRubric(fintech).fit).sectorFit).toBe(1);
    expect(fitFactors(profile, defaultRubric(logistics).fit).sectorFit).toBe(0.2);
    expect(fitFactors(profile).sectorFit).toBe(0.2); // the built-in rules are unchanged
  });

  it("validates the profile and makes a safe slug", () => {
    expect(ProfileSchema.safeParse({ name: "x", pitch: "short", sector: "s", stage: "ipo" }).success).toBe(false);
    expect(slugify("  Ledgerly & Co.! ")).toBe("ledgerly-co");
    expect(slugify("!!!")).toBe("startup");
  });
});

describe("generateRubric", () => {
  it("uses Gemini's rubric after clamping it, and labels the source", async () => {
    const base = defaultRubric(fintech);
    const ai: AiClient = { generateJson: async () => ({ ...base, weights: { recency: 20, relevance: 40, evidence: 20, fit: 15, relationship: 5 }, thresholds: { reachOutNow: 99, prepareOutreach: 50 } }) };
    const g = await generateRubric(ai, fintech);
    expect(g.source).toBe("gemini");
    expect(g.rubric.weights.relevance).toBe(40);
    expect(g.rubric.thresholds.reachOutNow).toBe(90);
  });

  it("falls back to the default, and says why, when Gemini is down or keeps returning invalid output", async () => {
    const down = await generateRubric({ generateJson: async () => { throw new AiError("unavailable", "x"); } }, fintech);
    expect(down).toMatchObject({ source: "default", note: "gemini_unavailable" });
    let n = 0;
    const bad = await generateRubric({ generateJson: async () => { n++; return { nope: true }; } }, fintech);
    expect(bad).toMatchObject({ source: "default", note: "gemini_invalid_output" });
    expect(n).toBe(2); // one retry, then the default
  });
});

describe("evaluateStartup", () => {
  beforeEach(seed);

  it("ranks the SAME evidence differently for different startups", async () => {
    const f = await startup(fintech), l = await startup(logistics);
    await evaluateStartup(db, judgeAi(), f, { now: NOW });
    await evaluateStartup(db, judgeAi(), l, { now: NOW });
    const fb = await scoreOf(f.slug, "Beta Payments Partners"), fa = await scoreOf(f.slug, "Alpha Freight Capital");
    const lb = await scoreOf(l.slug, "Beta Payments Partners"), la = await scoreOf(l.slug, "Alpha Freight Capital");
    expect(fb!.score).toBeGreaterThan(fa!.score); // for a payments startup the payments investor wins
    expect(la!.score).toBeGreaterThan(lb!.score); // for a logistics startup the freight investor wins
  });

  it("scores only investors that were actually searched, leaves out demo accounts, and says so", async () => {
    const s = await startup(fintech);
    const sum = await evaluateStartup(db, judgeAi(), s, { now: NOW });
    expect(sum).toMatchObject({ candidates: 4, searched: 3, scored: 3 });
    expect(await scoreOf(s.slug, "Delta Unsearched")).toBeUndefined(); // never searched: not scored, not "quiet"
    expect(await scoreOf(s.slug, "Piyush demo")).toBeUndefined();
    const steps = await getSteps(db, s.id);
    expect(steps.find((x) => x.step === "candidates")!.detail).toMatch(/1 has not been searched yet/);
    expect(steps.map((x) => x.status)).toEqual(["done", "partial", "done", "done", "done", "done"]); // rubric = partial: it is the default, not Gemini's
  });

  it("an investor with no relevant signal is not called quiet-and-fine when evidence could not be judged", async () => {
    const s = await startup(fintech);
    const sum = await evaluateStartup(db, judgeAi({ calls: 0 }, new AiError("rate_limited", "429")), s, { now: NOW });
    expect(sum.unjudged).toBe(2);
    const a = await scoreOf(s.slug, "Alpha Freight Capital");
    expect(a).toMatchObject({ coverage: "partial", action: "research_further" });
    const steps = await getSteps(db, s.id);
    expect(steps.find((x) => x.step === "judge")!.status).toBe("failed");
    expect(steps.find((x) => x.step === "score")!.status).toBe("partial");
  });

  it("is resumable and cached: a second run asks Gemini for nothing", async () => {
    const s = await startup(fintech);
    const c = { calls: 0 };
    await evaluateStartup(db, judgeAi(c), s, { now: NOW });
    const first = c.calls;
    expect(first).toBeGreaterThan(0);
    await evaluateStartup(db, judgeAi(c), s, { now: NOW });
    expect(c.calls).toBe(first);
  });

  it("re-scores after the rubric is edited without any model call, and the edit changes the result", async () => {
    const s = await startup(fintech);
    await evaluateStartup(db, judgeAi(), s, { now: NOW });
    const before = (await scoreOf(s.slug, "Beta Payments Partners"))!.score;
    const edited = sanitizeRubric({ ...s.rubric, weights: { recency: 5, relevance: 5, evidence: 5, fit: 60, relationship: 25 } }, s.rubric);
    await saveRubric(db, s.id, edited, "edited");
    await rescoreStartup(db, (await getStartup(db, s.slug))!, NOW);
    expect((await scoreOf(s.slug, "Beta Payments Partners"))!.score).not.toBe(before);
    expect((await getStartup(db, s.slug))!.rubric_source).toBe("edited");
    const j = (await getSteps(db, s.id)).find((x) => x.step === "judge")!;
    expect(j.status).toBe("done"); // the re-score did not rewrite the judge step
  });

  it("never reads or changes the founder's investor data (notes, relationship, scores)", async () => {
    const before = await db.query(`select * from investors order by firm_name`);
    const s = await startup(fintech);
    await evaluateStartup(db, judgeAi(), s, { now: NOW });
    expect((await db.query(`select * from investors order by firm_name`)).rows).toEqual(before.rows);
    // relationship is 'passed' in the founder's data; for another startup nobody has passed
    expect((await scoreOf(s.slug, "Beta Payments Partners"))!.action).not.toBe("no_action");
  });

  it("the new tables are unreadable to the refresh role and anon", async () => {
    await expect(db.tx((q) => q.query("select * from startups"), { role: "vc_refresh" })).rejects.toThrow(/permission denied/);
    await expect(db.tx((q) => q.query("select * from startup_scores"), { role: "vc_refresh" })).rejects.toThrow(/permission denied/);
  });
});
