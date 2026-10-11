import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { draftLinks, EmailDraft } from "@/components/EmailDraft";
import type { Db } from "@/lib/db";
import { DEMO_EMAIL, DEMO_SPECS, DEMO_TEXT, resetDemo, simulateRun } from "@/lib/demoData/seed";
import { applyFounderEdit } from "@/lib/founder";
import { filterPipeline, getOverview, getRunBar, listAudit, listPipeline, listRuns, listSignals } from "@/lib/read";
import { planRun } from "@/lib/refresh/plan";
import { rescoreAll } from "@/lib/refresh/rescore";
import { runChunk, startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";
import { getSimulationInputs } from "@/lib/simulate";
import { NOW, article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

let db: Db;
let rdb: Db;
const TODAY = new Date().toISOString().slice(0, 10);
const u = "https://news.example/real-alpha";

beforeAll(async () => { db = await makeTestDb(); rdb = asRefresh(db); });
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs, score_history restart identity cascade");
  // one REAL investor with private notes and a real refresh behind it
  await db.query(`insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography, personal_notes, relationship_status, contact_history)
                  values ('vc_firm', 'alpha', 'Alpha', 'https://alpha.vc', 'Seed', '{Logistics}', 'India', 'REAL PRIVATE NOTE', 'contacted', '[{"note":"real call"}]'::jsonb)`);
  const deps = mkDeps(fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(2))] }), fakePages({ [u]: article("Alpha", daysAgo(2)) }), fakeAi());
  const { run_id } = await startRun(rdb, "manual");
  await runChunk(rdb, deps, run_id, { batchEstimateMs: 0 });
});

const realSnapshot = async () => ({
  inv: (await db.query(`select to_jsonb(i) as r from investors i where not is_demo order by firm_name`)).rows,
  signals: (await db.query(`select count(*)::int n from signals s join investors i on i.id = s.investor_id where not i.is_demo`)).rows,
  runs: (await db.query(`select id, status, summary from runs where not is_demo order by started_at`)).rows,
  audit: (await db.query(`select count(*)::int n from audit_logs where investor_id in (select id from investors where not is_demo) or run_id in (select id from runs where not is_demo)`)).rows,
  hist: (await db.query(`select count(*)::int n from score_history h join investors i on i.id = h.investor_id where not i.is_demo`)).rows,
});

describe("the demo data", () => {
  it("is six clearly labelled Piyush accounts, one per situation, all addressed to the test email", async () => {
    await resetDemo(db);
    const rows = (await db.query(`select firm_name, role_title, fit_rationale, personal_notes, contact_email, verification_note, data_flags from investors where is_demo order by firm_name`)).rows as Record<string, any>[];
    expect(rows).toHaveLength(6);
    expect(DEMO_SPECS.map((s) => s.criterion)).toEqual(["High priority", "Low priority", "Stale signal", "Unverified signal", "Duplicate signal", "Irrelevant signal"]);
    for (const r of rows) {
      expect(r.firm_name).toMatch(/^Piyush: .+ \(demo\)$/);
      expect(r.contact_email).toBe(DEMO_EMAIL);
      expect(DEMO_EMAIL).toBe("sisonpiy@gmail.com");
      for (const text of [r.role_title, r.fit_rationale, r.personal_notes, r.verification_note]) expect(text).toContain(DEMO_TEXT);
      expect(r.data_flags).toContain("demo_account");
    }
  });

  it("is scored by the real engine and lands where each situation should", async () => {
    await resetDemo(db);
    const by = Object.fromEntries((await listPipeline(db, TODAY, true)).map((r) => [r.firm_name.replace(/^Piyush: | \(demo\)$/g, ""), r]));
    expect(by["High priority"]).toMatchObject({ recommended_action: "reach_out_now", state: "active" });
    expect(by["High priority"]!.follow_up_score).toBeGreaterThanOrEqual(75);
    expect(by["High priority"]!.angle).toContain(DEMO_TEXT); // an investor-specific draft exists, and it says it is demo
    // low priority: a real but off-sector deal is never "reach out now" and ranks below the high-priority one
    expect(by["Low priority"]!.recommended_action).not.toBe("reach_out_now");
    expect(by["Low priority"]!.follow_up_score!).toBeLessThan(by["High priority"]!.follow_up_score!);
    // stale: the only signal is outside the window
    expect(by["Stale signal"]).toMatchObject({ state: "stale", relevant_30d: 0 });
    expect(by["Stale signal"]!.recommended_action).not.toBe("reach_out_now");
    // unverified: looks relevant but is un-reviewed with an estimated date: never "reach out now"
    expect(by["Unverified signal"]!.recommended_action).not.toBe("reach_out_now");
    expect(by["Unverified signal"]!.needs_review_signals).toBe(1);
    // duplicate: the repeat is merged, not counted
    expect(by["Duplicate signal"]!.relevant_30d).toBe(1);
    expect((await db.query(`select count(*)::int n from signals where duplicate_of is not null`)).rows[0]).toEqual({ n: 1 });
    // irrelevant: a well-sourced but unrelated deal earns nothing
    expect(by["Irrelevant signal"]).toMatchObject({ state: "quiet_complete", relevant_30d: 0 });
    expect(by["Irrelevant signal"]!.follow_up_score!).toBeLessThanOrEqual(20);
  });

  it("each card carries its own investor's content and nobody else's", async () => {
    await resetDemo(db);
    const rows = await listPipeline(db, TODAY, true);
    for (const r of rows) {
      const slug = DEMO_SPECS.find((s) => r.firm_name.includes(s.criterion))!.key;
      if (r.lead) expect(r.lead.url).toContain(`/piyush-${slug}/`);
      const others = DEMO_SPECS.filter((s) => s.key !== slug).map((s) => `/piyush-${s.key}/`);
      for (const o of others) expect(JSON.stringify(r)).not.toContain(o);
    }
  });
});

describe("demo and real data are never mixed", () => {
  beforeEach(() => resetDemo(db));

  it("live views show only real investors, signals, runs and counts; demo views show only demo ones", async () => {
    const live = await listPipeline(db, TODAY);
    expect(live.map((r) => r.firm_name)).toEqual(["Alpha"]);
    expect(live.every((r) => !r.is_demo)).toBe(true);
    const demo = await listPipeline(db, TODAY, true);
    expect(demo).toHaveLength(6);
    expect(demo.every((r) => r.is_demo)).toBe(true);

    expect((await listSignals(db, TODAY, { show: "verified" })).every((s) => !s.is_demo)).toBe(true);
    expect((await listSignals(db, TODAY, { show: "verified" }, true)).every((s) => s.is_demo)).toBe(true);
    expect((await listRuns(db, 25)).every((r) => !/demo/i.test(r.summary ?? ""))).toBe(true);
    expect((await listRuns(db, 25, true)).length).toBeGreaterThan(0);
    expect((await getRunBar(db)).total).toBe(1);
    expect((await getRunBar(db, true)).total).toBe(6);
    expect((await getOverview(db, TODAY)).counts.total).toBe(1);
    expect((await getOverview(db, TODAY, true)).counts.total).toBe(6);
    expect((await getSimulationInputs(db)).map((s) => s.firm_name)).toEqual(["Alpha"]);
    expect((await getSimulationInputs(db, true)).length).toBe(6);
    expect((await listAudit(db, 100)).every((a) => !/demo/i.test(a.event))).toBe(true);
    expect((await listAudit(db, 100, true)).some((a) => a.event === "demo_reset")).toBe(true);
  });

  it("the main site can list both, labelled; counts, picks and run history still describe only the real pipeline, and demo accounts sort after real ones", async () => {
    const all = await listPipeline(db, TODAY, "all");
    expect(all).toHaveLength(7);
    expect(all.filter((r) => r.is_demo)).toHaveLength(6);
    const ov = await getOverview(db, TODAY, "all");
    expect(ov.counts.total).toBe(1); // the one real investor: synthetic accounts are never counted
    expect(ov.demoCount).toBe(6);
    expect(ov.runs.every((r) => !/demo/i.test(r.summary ?? ""))).toBe(true);
    // default (score) and recency sorts both keep real investors first, even though a demo account scores 95
    expect(filterPipeline(all, {}, TODAY)[0]!.is_demo).toBe(false);
    expect(filterPipeline(all, { sort: "recent" }, TODAY)[0]!.is_demo).toBe(false);
    expect((await listSignals(db, TODAY, { show: "verified" }, "all")).some((s) => s.is_demo)).toBe(true);
    expect((await getSimulationInputs(db, "all")).length).toBe(7); // 1 real + 6 demo accounts, all with a completed run_item
    expect((await getSimulationInputs(db)).length).toBe(1); // the default stays real-only
    // the high-priority demo account can still be found by filtering on priority, labelled as demo
    expect(filterPipeline(all, { priority: "high" }, TODAY).some((r) => r.is_demo && /High priority/.test(r.firm_name))).toBe(true);
  });

  it("a REAL refresh never plans, searches or scores a demo investor", async () => {
    const plan = await planRun(rdb, { recentHours: 0, coldDays: 0 });
    expect(plan.ids).toHaveLength(1);
    const searches: string[] = [];
    const deps = mkDeps({ name: "fake", search: async (q) => { searches.push(q.query); return []; } }, fakePages({}), fakeAi());
    const { run_id } = await startRun(rdb, "manual");
    await runChunk(rdb, deps, run_id, { batchEstimateMs: 0 });
    expect(searches.every((q) => !/piyush/i.test(q))).toBe(true);
    expect((await db.query(`select count(*)::int n from run_items ri join investors i on i.id = ri.investor_id where ri.run_id = $1 and i.is_demo`, [run_id])).rows[0]).toEqual({ n: 0 });
    // and the end-of-run re-score of un-searched investors leaves demo scores and history alone
    const before = (await db.query(`select count(*)::int n from score_history h join investors i on i.id = h.investor_id where i.is_demo`)).rows[0];
    await rescoreAll(rdb, new Date(NOW.getTime() + 5 * 86_400_000));
    expect((await db.query(`select count(*)::int n from score_history h join investors i on i.id = h.investor_id where i.is_demo`)).rows[0]).toEqual(before);
  });

  it("reset deletes only demo rows: real investors, notes, history, signals, runs and audit are byte-identical", async () => {
    const before = await realSnapshot();
    const r = await resetDemo(db);
    expect(r).toMatchObject({ removed: 6, created: 6 });
    expect(await realSnapshot()).toEqual(before);
    expect((await db.query(`select personal_notes, relationship_status, contact_history from investors where firm_name = 'Alpha'`)).rows[0]).toMatchObject({ personal_notes: "REAL PRIVATE NOTE", relationship_status: "contacted" });
    expect((await db.query(`select count(*)::int n from investors where is_demo`)).rows[0]).toEqual({ n: 6 });
    // resetting leaves no orphaned demo audit lines or runs behind
    await resetDemo(db);
    expect((await db.query(`select count(*)::int n from runs where is_demo`)).rows[0]).toEqual({ n: 1 });
    expect((await db.query(`select count(*)::int n from audit_logs where investor_id is null and run_id is null and left(event, 5) = 'demo_'`)).rows[0]).toEqual({ n: 0 });
    expect(await realSnapshot()).toEqual(before);
  });

  it("a demo founder edit works, and reset discards it; the real investor is unaffected", async () => {
    const id = ((await db.query(`select id from investors where is_demo limit 1`)).rows[0] as { id: string }).id;
    await applyFounderEdit(db, id, { personal_notes: "my demo note", relationship_status: "contacted" });
    expect((await db.query(`select personal_notes from investors where id = $1`, [id])).rows[0]).toEqual({ personal_notes: "my demo note" });
    await resetDemo(db);
    expect((await db.query(`select count(*)::int n from investors where is_demo and personal_notes = 'my demo note'`)).rows[0]).toEqual({ n: 0 });
    expect((await db.query(`select personal_notes from investors where firm_name = 'Alpha'`)).rows[0]).toEqual({ personal_notes: "REAL PRIVATE NOTE" });
  });

  it("a simulated refresh is a labelled demo run: it re-scores only demo investors, changes only the four signal columns, and spends nothing", async () => {
    const real = await realSnapshot();
    const protectedBefore = (await db.query(`select to_jsonb(i) - 'last_signal_date' - 'signal_summary' - 'follow_up_score' - 'recommended_action' as r from investors i where is_demo order by firm_name`)).rows;
    const s = await simulateRun(db, new Date(Date.now() + 6 * 86_400_000)); // a few days later: recency has moved on
    expect(s.investors).toBe(6);
    expect(s.changed).toBeGreaterThan(0);
    const run = (await db.query(`select is_demo, search_calls, summary from runs where id = $1`, [s.run_id])).rows[0] as { is_demo: boolean; search_calls: number; summary: string };
    expect(run).toMatchObject({ is_demo: true, search_calls: 0 });
    expect(run.summary).toMatch(/Simulated/);
    expect((await db.query(`select to_jsonb(i) - 'last_signal_date' - 'signal_summary' - 'follow_up_score' - 'recommended_action' as r from investors i where is_demo order by firm_name`)).rows).toEqual(protectedBefore);
    expect(await realSnapshot()).toEqual(real);
    expect((await listRuns(db, 25)).map((r) => r.id)).not.toContain(s.run_id);
  });
});

describe("opening a draft in the founder's own mail app", () => {
  it("builds a mailto: and a Gmail link to the right address, with subject and body encoded, and never sends anything", () => {
    const l = draftLinks({ to: DEMO_EMAIL, subject: "Intro & hello", body: "Line one\n\nLine two" });
    expect(l.mailto).toBe("mailto:sisonpiy@gmail.com?subject=Intro%20%26%20hello&body=Line%20one%0A%0ALine%20two");
    expect(l.gmail).toBe("https://mail.google.com/mail/?view=cm&fs=1&to=sisonpiy%40gmail.com&su=Intro%20%26%20hello&body=Line%20one%0A%0ALine%20two");
  });

  it("a real investor has no stored address, so the draft opens with an empty recipient (the app never invents contact details)", () => {
    expect(draftLinks({ to: null, subject: "s", body: "b" }).mailto).toBe("mailto:?subject=s&body=b");
  });

  it("the rendered control labels demo drafts and points at the right recipient", () => {
    const html = renderToStaticMarkup(createElement(EmailDraft, { to: DEMO_EMAIL, angle: `${DEMO_TEXT} Hello Piyush.`, demo: true }));
    expect(html).toContain("mailto:sisonpiy@gmail.com");
    expect(html).toContain("%5BDEMO%5D");
    expect(html).toContain("Open in email app");
    expect(html).toContain("This application never sends email");
  });
});
