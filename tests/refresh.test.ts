import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { ProviderError } from "@/lib/providers/types";
import { applySignalUpdate, asRefresh } from "@/lib/refresh/write";
import { runChunk, startRun } from "@/lib/refresh/run";
import { EXCERPT, article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

let db: Db; // owner connection (what the dashboard uses)
let rdb: Db; // restricted refresh-role connection (what the pipeline uses)
const ids: Record<string, string> = {};

async function addInvestor(name: string, extra: Record<string, unknown> = {}) {
  const cols = { entity_type: "vc_firm", name_key: name.toLowerCase(), firm_name: name, website_url: `https://${name.toLowerCase()}.vc`, stage_preference: "Seed", sectors: ["Logistics", "B2B SaaS"], geography: "India", ...extra };
  const keys = Object.keys(cols);
  const r = await db.query<{ id: string }>(
    `insert into investors (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    keys.map((k) => cols[k as keyof typeof cols]),
  );
  ids[name] = r.rows[0]!.id;
}

beforeAll(async () => {
  db = await makeTestDb(); // one migrated database for the file; tables are emptied between tests
  rdb = asRefresh(db);
});
afterAll(() => db.close());

beforeEach(async () => {
  await db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs restart identity cascade");
  await addInvestor("Alpha", {
    personal_notes: "Met Priya at SaaStr — warm, prefers email. DO NOT LOSE.",
    contact_history: JSON.stringify([{ date: "2026-09-02", channel: "email", note: "intro sent" }]),
    relationship_status: "contacted", last_contact_date: "2026-09-02", partner_name: "Priya Nair",
    partner_profile_url: "https://example.com/priya", investment_thesis: "Verified: seed-stage India B2B", thesis_verified: true,
  });
  await addInvestor("Beta");
  await addInvestor("Gamma");
});

/** Everything on an investor row EXCEPT the four signal columns — including created_at/updated_at. */
const protectedSnapshot = async () =>
  (await db.query(`select firm_name, to_jsonb(i) - 'last_signal_date' - 'signal_summary' - 'follow_up_score' - 'recommended_action' as row from investors i order by firm_name`)).rows;
type SignalCols = { last_signal_date: string | null; signal_summary: string | null; follow_up_score: number | null; recommended_action: string | null };
const signalCols = async (name: string) =>
  (await db.query<SignalCols>(`select last_signal_date::text as last_signal_date, signal_summary, follow_up_score, recommended_action from investors where id=$1`, [ids[name]])).rows[0]!;
const runRow = async (id: string) => (await db.query(`select * from runs where id=$1`, [id])).rows[0] as Record<string, unknown>;

const goodWorld = () => {
  const u = "https://news.example/alpha-raaho";
  return {
    search: fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(3))], Beta: [], Gamma: [] }),
    pages: fakePages({ [u]: article("Alpha", daysAgo(3)) }),
    ai: fakeAi(),
    url: u,
  };
};

async function fullRun(w: ReturnType<typeof goodWorld>, trigger: "cron" | "manual" = "manual") {
  const { run_id } = await startRun(rdb, trigger);
  const r = await runChunk(rdb, mkDeps(w.search, w.pages, w.ai), run_id, { budgetMs: 60_000, batchEstimateMs: 0 });
  return { run_id, r };
}

describe("CRITICAL: a refresh never touches founder-owned data", () => {
  it("updates exactly the four signal columns; every other column — notes, history, status, partner, thesis, timestamps — is byte-identical", async () => {
    const before = await protectedSnapshot();
    const sigBefore = await signalCols("Alpha");
    expect(sigBefore).toEqual({ last_signal_date: null, signal_summary: null, follow_up_score: null, recommended_action: null });

    const w = goodWorld();
    const { run_id, r } = await fullRun(w);
    expect(r).toMatchObject({ finished: true, status: "succeeded" });

    expect(await protectedSnapshot()).toEqual(before); // ← the guarantee

    const sig = await signalCols("Alpha");
    expect(sig.last_signal_date).toBe(daysAgo(3));
    expect(sig.follow_up_score).toBeGreaterThanOrEqual(70);
    expect(sig.recommended_action).toBe("reach_out_now");
    expect(sig.signal_summary).toMatch(/logistics marketplace/);
    // and the notes are still readable by the owner, exactly as written
    const notes = (await db.query(`select personal_notes, contact_history from investors where id=$1`, [ids.Alpha])).rows[0]!;
    expect(notes.personal_notes).toBe("Met Priya at SaaStr — warm, prefers email. DO NOT LOSE.");
    expect(notes.contact_history).toEqual([{ date: "2026-09-02", channel: "email", note: "intro sent" }]);
    expect((await runRow(run_id)).status).toBe("succeeded");
  });

  it("holds on repeated runs and when the founder edits notes between runs", async () => {
    const w = goodWorld();
    await fullRun(w);
    await db.query(`update investors set personal_notes = 'Updated after call', relationship_status = 'awaiting_response' where id=$1`, [ids.Alpha]);
    const before = await protectedSnapshot();
    await fullRun(w);
    await fullRun(w);
    expect(await protectedSnapshot()).toEqual(before);
  });

  it("holds through partial failure (one investor's search fails, another's AI fails)", async () => {
    const before = await protectedSnapshot();
    const w = goodWorld();
    w.search = fakeSearch({ Alpha: [hit(w.url, "Alpha", daysAgo(3))], Beta: new ProviderError("http_5xx", "boom"), Gamma: [] });
    const { r } = await fullRun(w);
    expect(r.status).toBe("partial");
    expect(await protectedSnapshot()).toEqual(before);
  });

  it("the pipeline's database role cannot read notes or write other columns even if the code tried", async () => {
    await expect(rdb.query(`select personal_notes from investors`)).rejects.toThrow(/permission denied/i);
    await expect(rdb.query(`update investors set personal_notes = null`)).rejects.toThrow(/permission denied/i);
    await expect(rdb.query(`update investors set relationship_status = 'passed'`)).rejects.toThrow(/permission denied/i);
    await expect(rdb.query(`select * from investors`)).rejects.toThrow(/permission denied/i); // `select *` would leak notes
  });

  it("applySignalUpdate rejects any payload carrying a non-allowlisted field, before touching SQL", async () => {
    for (const bad of [
      { last_signal_date: null, signal_summary: null, follow_up_score: 5, recommended_action: "no_action", personal_notes: "x" },
      { last_signal_date: null, signal_summary: null, follow_up_score: 5, recommended_action: "no_action", relationship_status: "passed" },
      { follow_up_score: 5 }, // incomplete
      { last_signal_date: null, signal_summary: null, follow_up_score: 101, recommended_action: "no_action" },
      { last_signal_date: null, signal_summary: null, follow_up_score: 5, recommended_action: "delete_everything" },
      { last_signal_date: "yesterday", signal_summary: null, follow_up_score: 5, recommended_action: "no_action" },
    ])
      await expect(rdb.tx((q) => applySignalUpdate(q, ids.Alpha!, bad))).rejects.toThrow();
    expect(await signalCols("Alpha")).toEqual({ last_signal_date: null, signal_summary: null, follow_up_score: null, recommended_action: null });
  });
});

describe("pipeline behaviour", () => {
  it("end to end: evidence is stored with source, date, excerpt, explanation; quiet investors are explicit; coverage + audit + counters are recorded", async () => {
    const w = goodWorld();
    const { run_id } = await fullRun(w);

    const s = (await db.query(`select * from signals where investor_id=$1 and verification_status='verified'`, [ids.Alpha])).rows;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      canonical_url: "https://news.example/alpha-raaho", published_at: daysAgo(3), date_source: "page", signal_type: "portfolio_investment",
      evidence_confidence: "high", relevance_score: 85, source_name: "news.example",
    });
    expect(s[0]!.evidence_excerpt).toMatch(/five million dollar Seed round/);
    expect(s[0]!.relevance_explanation).toBeTruthy();

    // Beta: search worked, found nothing → quiet, with the search recorded as "empty" (not "error")
    const beta = await signalCols("Beta");
    expect(beta.last_signal_date).toBeNull();
    expect(beta.follow_up_score).toBeLessThanOrEqual(20);
    expect(beta.signal_summary).toMatch(/No verified signal/);
    const cov = (await db.query(`select source, status from source_coverage where investor_id=$1 order by source`, [ids.Beta])).rows;
    expect(cov).toContainEqual({ source: "fake_search", status: "empty" });

    const run = await runRow(run_id);
    expect(run).toMatchObject({ status: "succeeded", investors_total: 3, investors_processed: 3, signals_accepted: 1, error_count: 0 });
    expect(run.records_updated).toBe(3);
    expect(run.completed_at).not.toBeNull();
    const out = (await db.query(`select outcome from run_items where run_id=$1 and investor_id=$2`, [run_id, ids.Alpha])).rows[0]!.outcome as Record<string, any>;
    expect(out.breakdown.recency.points).toBeGreaterThan(25);
    expect(out.explanation).toMatch(/Score \d+\/100/);
    expect((await db.query(`select 1 from audit_logs where run_id=$1 and event='signal_columns_updated'`, [run_id])).rowCount).toBe(3);
  });

  it("is idempotent: a second run adds no duplicate signals, makes no repeat AI/page calls for judged URLs, and writes no changes", async () => {
    const w = goodWorld();
    await fullRun(w);
    const aiCalls = w.ai.calls, fetches = w.pages.fetched.length;
    const sigCount = (await db.query(`select 1 from signals`)).rowCount;
    const { run_id } = await fullRun(w);
    expect((await db.query(`select 1 from signals`)).rowCount).toBe(sigCount);
    expect(w.ai.calls).toBe(aiCalls);
    expect(w.pages.fetched.length).toBe(fetches);
    expect((await runRow(run_id)).records_updated).toBe(0); // nothing changed → nothing written
  });

  it("rejects evidence for the right reasons and never accepts it: stale, undated, contradictory, wrong entity, duplicate coverage", async () => {
    const u = (n: string) => `https://news.example/${n}`;
    const search = fakeSearch({
      Alpha: [
        hit(u("old"), "Alpha", daysAgo(45)), hit(u("nodate"), "Alpha", null), hit(u("conflict"), "Alpha", daysAgo(2)),
        hit(u("other"), "Someone Else", daysAgo(2)), hit(u("dup-a"), "Alpha", daysAgo(4)), hit(u("dup-b"), "Alpha", daysAgo(4)), hit(u("future"), "Alpha", daysAgo(-20)),
      ],
    });
    const pages = fakePages({
      [u("old")]: article("Alpha", daysAgo(45)), [u("nodate")]: article("Alpha", null),
      [u("conflict")]: article("Alpha", daysAgo(2)).replace("</head>", `<meta name="date" content="${daysAgo(40)}"></head>`),
      [u("other")]: article("Someone Else", daysAgo(2)), [u("dup-a")]: article("Alpha", daysAgo(4)), [u("dup-b")]: article("Alpha", daysAgo(4)), [u("future")]: article("Alpha", daysAgo(-20)),
    });
    const ai = fakeAi();
    const { run_id } = await (async () => { const { run_id } = await startRun(rdb, "manual"); await runChunk(rdb, mkDeps(search, pages, ai), run_id, { batchEstimateMs: 0 }); return { run_id }; })();

    const rows = (await db.query(`select canonical_url, verification_status as s, rejection_reason as why, duplicate_of from signals where investor_id=$1`, [ids.Alpha])).rows;
    const why = (n: string) => rows.find((r) => String(r.canonical_url).endsWith(n))!;
    expect(why("/old")).toMatchObject({ s: "rejected", why: "out_of_window" });
    expect(why("/nodate")).toMatchObject({ s: "rejected", why: "missing_date" }); // no date anywhere → never defaulted to "recent"
    expect(why("/conflict")).toMatchObject({ s: "rejected", why: "contradictory_dates" });
    expect(why("/other")).toMatchObject({ s: "rejected", why: "entity_not_mentioned" });
    expect(why("/future")).toMatchObject({ s: "rejected", why: "future_date" });
    expect(rows.filter((r) => r.s === "verified")).toHaveLength(1);
    expect(rows.filter((r) => r.why === "duplicate_event")).toHaveLength(1);
    expect(rows.find((r) => r.why === "duplicate_event")!.duplicate_of).not.toBeNull();
    expect((await runRow(run_id)).duplicates_removed).toBe(1);
    // Only the surviving distinct candidate was analysed, in ONE batched call (the extra call is the optional opening angle).
    expect(ai.prompts.filter((p) => p.includes("<candidate"))).toHaveLength(1);
  });

  it("static profile / directory pages are rejected before any fetch or AI call", async () => {
    const cb = "https://www.crunchbase.com/organization/alpha";
    const search = fakeSearch({ Alpha: [hit(cb, "Alpha", daysAgo(2))], Beta: [] });
    const pages = fakePages({ [cb]: article("Alpha", daysAgo(2)) });
    const ai = fakeAi();
    await fullRun({ search, pages, ai, url: cb });
    expect(pages.fetched).toEqual([]);
    expect(ai.calls).toBe(0);
    expect((await db.query(`select rejection_reason from signals where canonical_url like '%crunchbase%'`)).rows).toEqual([{ rejection_reason: "profile_or_directory_page" }]);
  });

  describe("LinkedIn (via the search provider only)", () => {
    const post = "https://www.linkedin.com/posts/alpha-ventures_seed-round-activity-123";
    const prof = "https://www.linkedin.com/company/alpha";
    const run = async (search: ReturnType<typeof fakeSearch>) => {
      const pages = fakePages({});
      const ai = fakeAi();
      const { run_id } = await startRun(rdb, "manual");
      await runChunk(rdb, { ...mkDeps(search, pages, ai), linkedin: true }, run_id, { batchEstimateMs: 0 });
      return { run_id, pages, ai };
    };

    it("a LinkedIn post is judged from the search snippet: never fetched by us, confidence capped, profile pages rejected", async () => {
      const li = { ...hit(post, "Alpha", daysAgo(3)), snippet: `Alpha ${EXCERPT}. Excited to share this with our network.` };
      const search = fakeSearch({ Alpha: [], "Alpha@linkedin": [li, hit(prof, "Alpha", daysAgo(2))], Beta: [], Gamma: [] });
      const out = await run(search);
      expect(out.pages.fetched).toEqual([]); // LinkedIn's terms forbid automated fetching
      const s = (await db.query(`select evidence_confidence, date_source, verification_status from signals where canonical_url like '%linkedin.com/posts/%'`)).rows[0];
      expect(s).toEqual({ evidence_confidence: "medium", date_source: "search_estimate", verification_status: "verified" });
      expect((await db.query(`select rejection_reason from signals where canonical_url like '%linkedin.com/company/%'`)).rows).toEqual([{ rejection_reason: "profile_or_directory_page" }]);
      expect((await db.query(`select status from source_coverage where investor_id=$1 and source='fake_linkedin_search'`, [ids.Alpha])).rows[0]).toEqual({ status: "ok" });
    });

    it("an undated LinkedIn post is dated from its post ID and tagged as such; one with no ID stays rejected as undated", async () => {
      const dated = `https://www.linkedin.com/posts/alpha_seed-activity-${String(BigInt(Date.parse(daysAgo(4))) << 22n)}-zz`;
      const noId = "https://www.linkedin.com/posts/alpha_nothing-to-see";
      const snip = `Alpha ${EXCERPT}. A longer note so it clears the minimum content check.`;
      const search = fakeSearch({ Alpha: [], "Alpha@linkedin": [{ ...hit(dated, "Alpha", daysAgo(0)), published_date: null, snippet: snip }, { ...hit(noId, "Alpha", daysAgo(0)), published_date: null, snippet: snip }], Beta: [], Gamma: [] });
      await run(search);
      const rows = (await db.query(`select canonical_url, verification_status s, rejection_reason r, date_source, published_at::text d from signals where canonical_url like '%linkedin.com/posts/%'`)).rows as Record<string, string>[];
      const ok = rows.find((r) => r.canonical_url!.includes("activity-"))!;
      expect(ok).toMatchObject({ s: "verified", date_source: "post_id", d: daysAgo(4) });
      expect(rows.find((r) => r.canonical_url!.includes("nothing-to-see"))).toMatchObject({ s: "rejected", r: "missing_date" });
    });

    it("a failed LinkedIn search does not fail the investor, but makes an empty result inconclusive (partial)", async () => {
      const search = fakeSearch({ Alpha: [], "Alpha@linkedin": new ProviderError("rate_limited", "429"), Beta: [], Gamma: [] });
      const { run_id } = await run(search);
      const item = (await db.query(`select status, outcome->>'coverage' c from run_items where run_id=$1 and investor_id=$2`, [run_id, ids.Alpha])).rows[0];
      expect(item).toEqual({ status: "done", c: "partial" });
      expect((await db.query(`select status, error_category from source_coverage where investor_id=$1 and source='fake_linkedin_search'`, [ids.Alpha])).rows[0]).toEqual({ status: "error", error_category: "rate_limited" });
    });

    it("LinkedIn is only searched when enabled", async () => {
      const search = fakeSearch({ Alpha: [], Beta: [], Gamma: [] });
      const { run_id } = await startRun(rdb, "manual");
      await runChunk(rdb, mkDeps(search, fakePages({}), fakeAi()), run_id, { batchEstimateMs: 0 });
      expect((await db.query(`select 1 from source_coverage where source='fake_linkedin_search'`)).rowCount).toBe(0);
    });
  });

  it("missing evidence: with no candidates there is no AI call, and no signal is invented", async () => {
    const w = goodWorld();
    w.search = fakeSearch({ Alpha: [], Beta: [], Gamma: [] });
    await fullRun(w);
    expect(w.ai.calls).toBe(0);
    expect((await db.query(`select 1 from signals`)).rowCount).toBe(0);
    expect((await signalCols("Alpha")).last_signal_date).toBeNull();
  });

  it("a search failure is NOT treated as inactivity: the previous score is kept, coverage says 'error', the run is partial", async () => {
    // First, a good run establishes Alpha's score.
    const w = goodWorld();
    await fullRun(w);
    const good = await signalCols("Alpha");
    // Next run: Alpha's search is down.
    const down = fakeSearch({ Alpha: new ProviderError("http_5xx", "Tavily server error (503)"), Beta: [], Gamma: [] });
    const { run_id, r } = await fullRun({ ...w, search: down });
    expect(await signalCols("Alpha")).toEqual(good); // untouched — not reset to "quiet"
    const cov = (await db.query(`select status, error_category from source_coverage where investor_id=$1 and source='fake_search'`, [ids.Alpha])).rows[0];
    expect(cov).toEqual({ status: "error", error_category: "http_5xx" });
    const item = (await db.query(`select status, attempts, error from run_items where run_id=$1 and investor_id=$2`, [run_id, ids.Alpha])).rows[0]!;
    expect(item).toMatchObject({ status: "failed", attempts: 3, error: "search_failed:http_5xx" }); // bounded retries
    expect(r.status).toBe("partial");
    const run = await runRow(run_id);
    expect(run.error_count).toBe(3);
    expect(run.summary).toMatch(/2 investors refreshed, 1 failed/);
  });

  it("non-retryable failures (missing credentials, exhausted quota) fail immediately without burning retries", async () => {
    const w = goodWorld();
    const search = fakeSearch({ Alpha: new ProviderError("no_credentials", "TAVILY_API_KEY is not set"), Beta: new ProviderError("quota_exhausted", "plan limit"), Gamma: [] });
    const { run_id, r } = await fullRun({ ...w, search });
    const items = (await db.query(`select investor_id, status, attempts from run_items where run_id=$1`, [run_id])).rows;
    expect(items.find((i) => i.investor_id === ids.Alpha)).toMatchObject({ status: "failed", attempts: 1 });
    expect(items.find((i) => i.investor_id === ids.Beta)).toMatchObject({ status: "failed", attempts: 1 });
    expect(r.status).toBe("partial");
  });

  it("invalid Gemini output cannot cause a write: items fail, evidence is kept as needs_review, the score stays null", async () => {
    const w = goodWorld();
    const { run_id, r } = await fullRun({ ...w, ai: fakeAi({}, "garbage") });
    expect(await signalCols("Alpha")).toEqual({ last_signal_date: null, signal_summary: null, follow_up_score: null, recommended_action: null });
    const s = (await db.query(`select verification_status, rejection_reason from signals where investor_id=$1`, [ids.Alpha])).rows;
    expect(s).toEqual([{ verification_status: "needs_review", rejection_reason: "ai_invalid_output" }]);
    expect((await db.query(`select status from run_items where run_id=$1 and investor_id=$2`, [run_id, ids.Alpha])).rows[0]).toEqual({ status: "failed" });
    expect(r.status).toBe("partial");
    expect((await db.query(`select 1 from source_coverage where investor_id=$1 and source='gemini_analysis' and status='error'`, [ids.Alpha])).rowCount).toBe(1);
  });

  it("a Gemini outage fails the item with a typed category and no model fallback", async () => {
    const w = goodWorld();
    const ai = fakeAi({}, "down");
    const { run_id } = await fullRun({ ...w, ai });
    const e = (await db.query(`select error from run_items where run_id=$1 and investor_id=$2`, [run_id, ids.Alpha])).rows[0]!.error;
    expect(e).toBe("ai_failed:unavailable");
    expect((await signalCols("Alpha")).follow_up_score).toBeNull();
  });

  it("hostile model output (SQL, control chars, markup, relevance 100) is parameterised and sanitised; tables survive", async () => {
    const w = goodWorld();
    await fullRun({ ...w, ai: fakeAi({}, "malicious") });
    expect((await db.query(`select 1 from investors`)).rowCount).toBe(3); // still there
    const sig = await signalCols("Alpha");
    expect(sig.signal_summary).not.toMatch(/[\u0000-\u001f]/);
    expect(sig.signal_summary!.length).toBeLessThanOrEqual(500);
    expect(sig.follow_up_score).toBeLessThanOrEqual(100);
  });

  it("a page fetch failure falls back to the search snippet with capped confidence and marks coverage partial", async () => {
    const w = goodWorld();
    w.pages = fakePages({ [w.url]: new ProviderError("http_5xx", "origin down") });
    w.search = fakeSearch({ Alpha: [hit(w.url, "Alpha", daysAgo(3))], Beta: [], Gamma: [] });
    // snippet must be long enough to count as content
    w.search = fakeSearch({ Alpha: [{ ...hit(w.url, "Alpha", daysAgo(3)), snippet: `Alpha ${"led a five million dollar Seed round in a freight marketplace for trucking fleets. ".repeat(2)}` }], Beta: [], Gamma: [] });
    await fullRun(w);
    const s = (await db.query(`select date_source, evidence_confidence from signals where investor_id=$1 and verification_status='verified'`, [ids.Alpha])).rows[0]!;
    expect(s).toEqual({ date_source: "search_estimate", evidence_confidence: "medium" }); // never "high" without the page
    expect((await db.query(`select status from source_coverage where investor_id=$1 and source='page_fetch'`, [ids.Alpha])).rows[0]).toEqual({ status: "error" });
  });

  it("an unfetchable page that the search snippet can stand in for does NOT make the investor 'partial'", async () => {
    const w = goodWorld();
    const snippetOk = { ...hit(w.url, "Alpha", daysAgo(3)), snippet: `Alpha ${"led a five million dollar Seed round in a freight marketplace for trucking fleets. ".repeat(2)}` };
    const { run_id } = await fullRun({ ...w, pages: fakePages({ [w.url]: new ProviderError("http_5xx", "blocked") }), search: fakeSearch({ Alpha: [snippetOk], Beta: [], Gamma: [] }) });
    const out = (await db.query(`select outcome->>'coverage' c from run_items where run_id=$1 and investor_id=$2`, [run_id, ids.Alpha])).rows[0] as { c: string };
    expect(out.c).toBe("complete");
  });

  it("a database failure mid-persist rolls the whole investor back (no half-written signals) and the retry then succeeds", async () => {
    const w = goodWorld();
    let failed = false;
    const flaky: Db = {
      ...rdb,
      tx: (fn) => rdb.tx(async (q) => fn({
        query: async (sql, p) => {
          if (!failed && /update investors set/.test(sql) && p?.[0] === ids.Alpha) { failed = true; throw new Error("connection reset"); }
          return q.query(sql, p);
        },
      })),
    };
    const { run_id } = await startRun(flaky, "manual");
    const r = await runChunk(flaky, mkDeps(w.search, w.pages, w.ai), run_id, { batchEstimateMs: 0 });
    expect(failed).toBe(true);
    expect(r.status).toBe("succeeded"); // retried within the same run
    const attempts = (await db.query(`select attempts from run_items where run_id=$1 and investor_id=$2`, [run_id, ids.Alpha])).rows[0]!.attempts;
    expect(attempts).toBe(2);
    expect((await db.query(`select 1 from run_items where run_id=$1 and attempts = 1`, [run_id])).rowCount).toBe(2); // the others were not disturbed
    expect((await db.query(`select 1 from signals where investor_id=$1 and verification_status='verified'`, [ids.Alpha])).rowCount).toBe(1); // exactly one, no orphan
  });
});

describe("run lifecycle", () => {
  it("only one run may be active: a second trigger gets the existing run, not a new one", async () => {
    const a = await startRun(rdb, "cron");
    const b = await startRun(rdb, "manual");
    expect(a.state).toBe("started");
    expect(b).toEqual({ run_id: a.run_id, state: "already_running" });
    expect((await db.query(`select 1 from runs`)).rowCount).toBe(1);
    expect((await db.query(`select 1 from run_items`)).rowCount).toBe(3);
  });

  it("concurrent triggers still produce exactly one run", async () => {
    const results = await Promise.all([startRun(rdb, "cron"), startRun(rdb, "manual"), startRun(rdb, "manual")]);
    expect(new Set(results.map((r) => r.run_id)).size).toBe(1);
    expect(results.filter((r) => r.state === "started")).toHaveLength(1);
  });

  it("work is chunked: a bounded invocation leaves the run 'running' (no premature success), and a later one finishes it", async () => {
    const w = goodWorld();
    const { run_id } = await startRun(rdb, "cron");
    const first = await runChunk(rdb, mkDeps(w.search, w.pages, w.ai), run_id, { maxItems: 1, concurrency: 1, batchEstimateMs: 0 });
    expect(first).toMatchObject({ finished: false, remaining: 2 });
    expect(await runRow(run_id)).toMatchObject({ status: "running", completed_at: null, investors_processed: 1 });
    const second = await runChunk(rdb, mkDeps(w.search, w.pages, w.ai), run_id, { batchEstimateMs: 0 });
    expect(second).toMatchObject({ finished: true, remaining: 0, status: "succeeded" });
    expect((await runRow(run_id)).investors_processed).toBe(3);
  });

  it("recovers from an interrupted invocation: stale 'running' items are re-queued and a stale run is resumed, not duplicated", async () => {
    const w = goodWorld();
    const { run_id } = await startRun(rdb, "cron");
    // Simulate a function killed mid-chunk: one item stuck 'running', heartbeat long ago.
    await db.query(`update run_items set status='running', started_at = now() - interval '1 hour', attempts = 1 where run_id=$1 and investor_id=$2`, [run_id, ids.Alpha]);
    await db.query(`update runs set heartbeat_at = now() - interval '1 hour' where id=$1`, [run_id]);
    const resumed = await startRun(rdb, "manual");
    expect(resumed).toEqual({ run_id, state: "resumed" });
    const r = await runChunk(rdb, mkDeps(w.search, w.pages, w.ai), run_id, { batchEstimateMs: 0 });
    expect(r).toMatchObject({ finished: true, status: "succeeded" });
    expect((await db.query(`select 1 from runs`)).rowCount).toBe(1);
    expect((await db.query(`select 1 from audit_logs where run_id=$1 and event='run_resumed_after_interruption'`, [run_id])).rowCount).toBe(1);
  });

  it("a fresh heartbeat means the run is genuinely active, so a trigger does not steal it", async () => {
    const { run_id } = await startRun(rdb, "cron");
    expect(await startRun(rdb, "manual")).toEqual({ run_id, state: "already_running" });
  });

  it("after completion a new run can start; the earlier run keeps its final status", async () => {
    const w = goodWorld();
    const a = await fullRun(w);
    const b = await startRun(rdb, "manual");
    expect(b.state).toBe("started");
    expect(b.run_id).not.toBe(a.run_id);
    expect((await runRow(a.run_id)).status).toBe("succeeded");
  });
});
