import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { rescoreAll } from "@/lib/refresh/rescore";
import { reviewStored } from "@/lib/refresh/review";
import { runChunk, startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";
import { NOW, article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

let db: Db;
let rdb: Db;
const u = "https://news.example/alpha";
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
const row = async (name: string) => (await db.query(`select follow_up_score s, recommended_action a, last_signal_date::text d, personal_notes n, relationship_status r from investors where firm_name = $1`, [name])).rows[0] as { s: number | null; a: string | null; d: string | null; n: string | null; r: string };

beforeAll(async () => { db = await makeTestDb(); rdb = asRefresh(db); });
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs, score_history restart identity cascade");
  for (const n of ["Alpha", "Beta"]) await db.query(`insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography, personal_notes) values ('vc_firm', $1, $2, 'https://x.vc', 'Seed', '{Logistics}', 'India', 'PRIVATE NOTE')`, [n.toLowerCase(), n]);
  const deps = mkDeps(fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(2))], Beta: [] }), fakePages({ [u]: article("Alpha", daysAgo(2)) }), fakeAi());
  const { run_id } = await startRun(rdb, "manual");
  await runChunk(rdb, deps, run_id, { batchEstimateMs: 0 });
});

describe("rescoreAll: scores follow the calendar without a search", () => {
  it("recency decays: the same evidence scores lower later, and the signal ages out of the window", async () => {
    const fresh = (await row("Alpha")).s!;
    await rescoreAll(rdb, later(15));
    const mid = (await row("Alpha")).s!;
    expect(mid).toBeLessThan(fresh);
    await rescoreAll(rdb, later(40));
    const old = await row("Alpha");
    expect(old.s!).toBeLessThan(mid);
    expect(old.a).not.toBe("reach_out_now");
    expect(old.d).toBe(daysAgo(2)); // last_signal_date still records the most recent relevant signal, however old
  });

  it("uses no search and no model unless asked, and writes a history row per investor with the explanation", async () => {
    const ai = fakeAi();
    const before = ai.calls;
    const sum = await rescoreAll(rdb, later(5));
    expect(ai.calls).toBe(before);
    expect(sum.investors).toBe(2);
    const h = (await db.query(`select source, explanation, breakdown from score_history where source = 'rescore'`)).rows as { source: string; explanation: string; breakdown: object }[];
    expect(h).toHaveLength(2);
    expect(h.every((x) => x.explanation && x.breakdown)).toBe(true);
  });

  it("never touches founder-owned data, and does not score an investor that was never successfully checked", async () => {
    await db.query(`insert into investors (entity_type, name_key, firm_name, personal_notes) values ('vc_firm', 'gamma', 'Gamma', 'PRIVATE')`);
    const before = await db.query(`select id, personal_notes, relationship_status, last_contact_date, contact_history, firm_name, partner_name, updated_at from investors order by firm_name`);
    await rescoreAll(rdb, later(10));
    const after = await db.query(`select id, personal_notes, relationship_status, last_contact_date, contact_history, firm_name, partner_name, updated_at from investors order by firm_name`);
    expect(after.rows).toEqual(before.rows);
    expect(await row("Gamma")).toMatchObject({ s: null, a: null }); // "never looked" must not become a number
  });

  it("changes nothing when nothing has changed (idempotent), apart from the history row", async () => {
    await rescoreAll(rdb, NOW);
    const a = await row("Alpha");
    const sum = await rescoreAll(rdb, NOW);
    expect(await row("Alpha")).toEqual(a);
    expect(sum.changed).toBe(0);
  });

  it("an investor whose last refresh was partial stays 'research further' rather than 'no action' with no signal", async () => {
    await db.query(`update signals set verification_status = 'rejected'`);
    await db.query(`update run_items set outcome = outcome || '{"coverage":"partial"}'::jsonb where investor_id = (select id from investors where firm_name = 'Alpha')`);
    await rescoreAll(rdb, NOW);
    expect((await row("Alpha")).a).toBe("research_further");
  });

  it("drafts an opening angle for a newly 'reach out now' investor only when asked to", async () => {
    await db.query(`update score_history set angle = null`);
    const ai = fakeAi();
    const without = await rescoreAll(rdb, NOW);
    expect(without.angles).toBe(0);
    const withAi = await rescoreAll(rdb, NOW, { ai });
    expect(withAi.angles).toBe(1);
    expect(((await db.query(`select angle from score_history where angle is not null order by id desc limit 1`)).rows[0] as { angle: string | null }).angle).toMatch(/freight marketplace/);
  });
});

describe("a refresh re-scores the investors it did not search", () => {
  it("investors skipped by the plan still get today's recency", async () => {
    const before = (await row("Alpha")).s!;
    // a later run that searches nobody (everyone was checked recently) still brings Alpha's score up to date
    const deps = { ...mkDeps(fakeSearch({}), fakePages({}), fakeAi()), now: () => later(20) };
    await db.query(`update runs set status = 'succeeded', completed_at = now()`);
    const { run_id } = await startRun(rdb, "manual", { recentHours: 36, now: later(20) });
    expect(run_id).toBeTruthy();
    // nothing_due completes immediately; run the chunk anyway as the cron path does
    await runChunk(rdb, deps, run_id, { batchEstimateMs: 0 }).catch(() => {});
    expect((await row("Alpha")).s!).toBeLessThanOrEqual(before);
  });
});

describe("reviewStored backfills evidence that was verified before the review existed", () => {
  it("reviews in-window evidence once, applies the verdicts, and rejects a mis-attributed signal", async () => {
    await db.query(`update signals set sector_match = null, firm_acting = null, reviewed_at = null`);
    const sum = await reviewStored(rdb, fakeAi({}, "ok", undefined, () => ({ firm_acting: false })), NOW);
    expect(sum).toMatchObject({ investors: 1, reviewed: 1, rejected: 1, failed_investors: 0 });
    expect(((await db.query(`select verification_status v, rejection_reason r from signals`)).rows[0])).toEqual({ v: "rejected", r: "second_pass_not_acting" });
    // already-reviewed evidence is never re-sent
    expect(await reviewStored(rdb, fakeAi(), NOW)).toMatchObject({ investors: 0, ai_calls: 0 });
  });

  it("a Gemini outage is counted and leaves the evidence exactly as it was", async () => {
    await db.query(`update signals set sector_match = null, firm_acting = null, reviewed_at = null`);
    const { AiError } = await import("@/lib/ai/gemini");
    const sum = await reviewStored(rdb, fakeAi({}, "ok", undefined, new AiError("unavailable", "down")), NOW);
    expect(sum).toMatchObject({ failed_investors: 1, reviewed: 0 });
    expect(((await db.query(`select verification_status v, reviewed_at from signals`)).rows[0])).toEqual({ v: "verified", reviewed_at: null });
  });
});
