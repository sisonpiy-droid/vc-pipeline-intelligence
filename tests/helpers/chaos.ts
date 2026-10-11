import { AiError, type AiClient } from "@/lib/ai/gemini";
import type { Db } from "@/lib/db";
import { ProviderError, type PageFetcher, type SearchProvider } from "@/lib/providers/types";
import { listPipeline } from "@/lib/read";
import type { Deps } from "@/lib/refresh/research";
import { runChunk, startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";
import { NOW, article, daysAgo, fakeAi, fakePages, fakeSearch, hit } from "./fakes";
import { makeTestDb } from "./testDb";

/**
 * Fault injection for the refresh pipeline. A deterministic (seeded) world of investors with real-looking evidence is run
 * while every external dependency fails at random: search 429/5xx/timeouts, unreadable pages, Gemini outages and garbage
 * answers, and database transactions that die AFTER their writes (so rollback is what saves the data). It also simulates a
 * crashed invocation. Afterwards a set of invariants is checked, and a clean recovery run must converge to exactly what a
 * fault-free run produces. The same engine backs tests/chaos.test.ts and `npm run chaos`.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SENTINEL_NOTE = (i: number) => `PRIVATE-NOTE-${i}`;
const STATUSES = ["not_contacted", "contacted", "awaiting_response", "passed"] as const;
const name = (i: number) => `Firm${String(i).padStart(2, "0")}`;

interface World { search: SearchProvider; pages: PageFetcher; ai: AiClient }

/** A fixed world: every third investor has a real, verifiable logistics article; the rest have nothing to find. */
function cleanWorld(n: number): World {
  const hits: Record<string, ReturnType<typeof hit>[]> = {};
  const pages: Record<string, string> = {};
  const rules: Record<string, { relevance: number }> = {};
  for (let i = 0; i < n; i++) {
    hits[name(i)] = [];
    if (i % 3 === 0) {
      const u = `https://news.example/${name(i).toLowerCase()}`;
      hits[name(i)]!.push(hit(u, name(i), daysAgo(2 + (i % 9))));
      pages[u] = article(name(i), daysAgo(2 + (i % 9)));
      rules[u] = { relevance: 60 + (i % 5) * 8 };
    }
  }
  return { search: fakeSearch(hits), pages: fakePages(pages), ai: fakeAi(rules) };
}

type Injected = Record<string, number>;

function faulty(w: World, rnd: () => number, rate: number, inj: Injected): Deps {
  const bump = (k: string) => { inj[k] = (inj[k] ?? 0) + 1; };
  const roll = () => rnd() < rate;
  const search: SearchProvider = {
    name: w.search.name,
    async search(q) {
      if (roll()) {
        const kinds = ["rate_limited", "http_5xx", "timeout", "malformed"] as const;
        const k = kinds[Math.floor(rnd() * kinds.length)]!;
        bump(`search:${k}`);
        throw new ProviderError(k, `injected ${k}`);
      }
      return w.search.search(q);
    },
  };
  const pages: PageFetcher = {
    async fetch(url) {
      if (roll()) { bump("page:unreadable"); throw new ProviderError(rnd() < 0.5 ? "http_5xx" : "timeout", "injected page failure"); }
      return w.pages.fetch(url);
    },
  };
  const ai: AiClient = {
    async generateJson(req) {
      const r = rnd();
      if (r < rate * 0.4) { bump("gemini:unavailable"); throw new AiError("unavailable", "injected outage"); }
      if (r < rate * 0.7) { bump("gemini:rate_limited"); throw new AiError("rate_limited", "injected 429"); }
      if (r < rate) { bump("gemini:garbage"); return { assessments: "not an array", reviews: 7, extra: "<script>" }; }
      return w.ai.generateJson(req);
    },
  };
  return { search, pages, ai, now: () => NOW };
}

/** A database whose transactions sometimes fail AFTER running their statements: only rollback keeps the data consistent. */
function flakyDb(rdb: Db, rnd: () => number, rate: number, inj: Injected): Db {
  return {
    ...rdb,
    tx: (fn, o) => rdb.tx(async (q) => {
      const out = await fn(q);
      if (rnd() < rate / 3) { inj["db:fail_after_writes"] = (inj["db:fail_after_writes"] ?? 0) + 1; throw new Error("injected: connection reset after writes"); }
      return out;
    }, o),
  };
}

export interface Invariant { name: string; ok: boolean; detail?: string }
export interface ChaosReport {
  seed: number;
  rate: number;
  investors: number;
  injected: Injected;
  chaos_run: { status: string; done: number; failed: number; attempts: number; resumed: boolean };
  recovery_status: string;
  invariants: Invariant[];
}

const PROTECTED = `select firm_name, to_jsonb(i) - 'last_signal_date' - 'signal_summary' - 'follow_up_score' - 'recommended_action' as row from investors i order by firm_name`;

async function seedInvestors(db: Db, n: number) {
  for (let i = 0; i < n; i++)
    await db.query(
      `insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography, personal_notes, relationship_status, last_contact_date, contact_history, partner_name)
       values ('vc_firm', $1, $2, $3, 'Seed', '{Logistics,B2B SaaS}', 'India', $4, $5, $6, $7::jsonb, $8)`,
      [name(i).toLowerCase(), name(i), `https://${name(i).toLowerCase()}.vc`, SENTINEL_NOTE(i), STATUSES[i % STATUSES.length], i % 4 === 0 ? null : daysAgo(5), JSON.stringify([{ date: daysAgo(9), channel: "email", note: `history-${i}` }]), `Partner ${i}`],
    );
}

/** What a fault-free run produces for the same world: the answer every recovery must converge to. */
export async function baseline(n: number): Promise<Map<string, { score: number | null; action: string | null }>> {
  const db = await makeTestDb();
  try {
    await seedInvestors(db, n);
    const rdb = asRefresh(db);
    const w = cleanWorld(n);
    const { run_id } = await startRun(rdb, "manual");
    await runChunk(rdb, { ...w, now: () => NOW }, run_id, { batchEstimateMs: 0, concurrency: 4 });
    const rows = (await db.query<{ firm_name: string; follow_up_score: number | null; recommended_action: string | null }>(`select firm_name, follow_up_score, recommended_action from investors`)).rows;
    return new Map(rows.map((r) => [r.firm_name, { score: r.follow_up_score, action: r.recommended_action }]));
  } finally {
    await db.close();
  }
}

export async function runChaos(cfg: { seed: number; rate: number; investors?: number }, expected: Map<string, { score: number | null; action: string | null }>): Promise<ChaosReport> {
  const n = cfg.investors ?? 24;
  const rnd = rng(cfg.seed);
  const inj: Injected = {};
  const db = await makeTestDb();
  const checks: Invariant[] = [];
  const check = (nm: string, ok: boolean, detail?: string) => checks.push({ name: nm, ok, detail: ok ? undefined : detail });
  try {
    await seedInvestors(db, n);
    const rdb = asRefresh(db);
    const protectedBefore = (await db.query(PROTECTED)).rows;

    // ── chaos run: many small invocations, one simulated crash, every dependency failing at random ──
    const w = cleanWorld(n);
    const deps = faulty(w, rnd, cfg.rate, inj);
    const fdb = flakyDb(rdb, rnd, cfg.rate, inj);
    const started = await startRun(rdb, "manual");
    let resumed = false;
    let finished = false;
    for (let call = 0; call < 60 && !finished; call++) {
      const r = await runChunk(fdb, deps, started.run_id, { batchEstimateMs: 0, concurrency: 3, maxItems: 6 });
      finished = r.finished;
      if (!finished && call === 1) {
        // simulate an invocation that died mid-flight: items stuck in 'running', run heartbeat gone stale
        await db.query(`update run_items set status = 'running', started_at = now() - interval '10 minutes' where (run_id, investor_id) in (select run_id, investor_id from run_items where run_id = $1 and status = 'pending' limit 3)`, [started.run_id]);
        await db.query(`update runs set heartbeat_at = now() - interval '20 minutes' where id = $1`, [started.run_id]);
        resumed = (await startRun(rdb, "manual")).state === "resumed";
      }
    }
    const run = (await db.query<{ status: string; investors_total: number; investors_processed: number; error_count: number }>(`select status, investors_total, investors_processed, error_count from runs where id = $1`, [started.run_id])).rows[0]!;
    const items = (await db.query<{ investor_id: string; status: string; attempts: number }>(`select investor_id, status, attempts from run_items where run_id = $1`, [started.run_id])).rows;
    const done = items.filter((i) => i.status === "done").length;
    const failed = items.filter((i) => i.status === "failed").length;

    check("the run always reaches a final state, never stuck 'running'", finished && run.status !== "running", `status ${run.status}`);
    check("every investor in the run is final (done or failed), none pending", items.every((i) => i.status === "done" || i.status === "failed"));
    check("run status is honest: succeeded only if nothing failed, failed only if nothing succeeded", run.status === (failed === 0 ? "succeeded" : done === 0 ? "failed" : "partial"), `${run.status} with ${done} done / ${failed} failed`);
    check("investors_processed equals the investors in the run", run.investors_processed === run.investors_total, `${run.investors_processed} vs ${run.investors_total}`);

    check("founder-owned and profile columns are byte-identical after faults, retries and a crash", JSON.stringify((await db.query(PROTECTED)).rows) === JSON.stringify(protectedBefore));

    const failedIds = items.filter((i) => i.status === "failed").map((i) => i.investor_id);
    const sigAfter = (await db.query<{ id: string; follow_up_score: number | null }>(`select id, follow_up_score from investors where id = any($1::uuid[])`, [failedIds])).rows;
    check("an investor whose refresh failed was never given a score by it (a failure is not 'quiet')", sigAfter.every((r) => r.follow_up_score === null), JSON.stringify(sigAfter.filter((r) => r.follow_up_score !== null).length));
    const states = await listPipeline(db, daysAgo(0));
    check("no failed investor is displayed as quiet or has 'no signal' — they read as failed", states.filter((s) => failedIds.includes(s.id)).every((s) => s.state === "failed" || s.state === "active"), states.filter((s) => failedIds.includes(s.id)).map((s) => s.state).join(","));

    const bad = (await db.query(`select count(*)::int n from signals where verification_status = 'verified' and (published_at is null or published_at < $1::date or published_at > $2::date)`, [daysAgo(31), daysAgo(-1)])).rows[0] as { n: number };
    check("no verified signal is undated or outside the 30-day window", bad.n === 0);
    const dup = (await db.query(`select count(*)::int n from (select investor_id, canonical_url from signals group by 1, 2 having count(*) > 1) d`)).rows[0] as { n: number };
    check("no duplicate evidence rows", dup.n === 0);
    const reach = (await db.query<{ firm_name: string; reviewed: boolean | null; sm: string | null }>(
      `select i.firm_name, bool_or(s.reviewed_at is not null) as reviewed, max(s.sector_match) as sm from investors i left join signals s on s.investor_id = i.id and s.verification_status = 'verified' where i.recommended_action = 'reach_out_now' group by i.firm_name`,
    )).rows;
    check("nobody is 'reach out now' on evidence that never passed the second-pass review", reach.every((r) => r.reviewed && r.sm === "logistics"), JSON.stringify(reach.filter((r) => !r.reviewed || r.sm !== "logistics")));
    const hist = (await db.query<{ firm_name: string; follow_up_score: number | null; score: number | null }>(
      `select i.firm_name, i.follow_up_score, h.score from investors i left join lateral (select score from score_history where investor_id = i.id order by at desc, id desc limit 1) h on true where i.follow_up_score is not null`,
    )).rows;
    check("the stored score always equals the latest score-history row", hist.every((r) => r.follow_up_score === r.score), JSON.stringify(hist.filter((r) => r.follow_up_score !== r.score)));

    // ── recovery: faults off; the system must converge to the fault-free answer ──
    const clean: Deps = { ...cleanWorld(n), now: () => NOW };
    let rec = "none";
    for (let k = 0; k < 3; k++) {
      const s = await startRun(rdb, "manual");
      await runChunk(rdb, clean, s.run_id, { batchEstimateMs: 0, concurrency: 4 });
      rec = (await db.query<{ status: string }>(`select status from runs where id = $1`, [s.run_id])).rows[0]!.status;
    }
    check("a fault-free run after the chaos succeeds", rec === "succeeded", rec);
    const finalRows = (await db.query<{ firm_name: string; follow_up_score: number | null; recommended_action: string | null }>(`select firm_name, follow_up_score, recommended_action from investors`)).rows;
    const diffs = finalRows.filter((r) => { const e = expected.get(r.firm_name); return !e || e.score !== r.follow_up_score || e.action !== r.recommended_action; }).map((r) => `${r.firm_name}: got ${r.follow_up_score}/${r.recommended_action}, expected ${expected.get(r.firm_name)?.score}/${expected.get(r.firm_name)?.action}`);
    check("after recovery every investor's score and action equal a fault-free run's (nothing permanently lost or wrong)", diffs.length === 0, diffs.slice(0, 4).join("; "));
    check("founder-owned columns are still byte-identical after recovery", JSON.stringify((await db.query(PROTECTED)).rows) === JSON.stringify(protectedBefore));

    return { seed: cfg.seed, rate: cfg.rate, investors: n, injected: inj, chaos_run: { status: run.status, done, failed, attempts: items.reduce((a, i) => a + i.attempts, 0), resumed }, recovery_status: rec, invariants: checks };
  } finally {
    await db.close();
  }
}

void fakePages;
