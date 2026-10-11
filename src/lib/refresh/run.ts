import type { Db } from "@/lib/db";
import { planRun, type PlanOptions } from "./plan";
import { processInvestor, zeroCounters, type ItemResult } from "./process";
import { loadInvestor, rescoreAll } from "./rescore";
import type { Deps } from "./research";

/**
 * Run lifecycle. A "run" is a row in `runs` plus one `run_items` row per investor — a durable queue.
 * Nothing here assumes a single invocation can finish the whole job: each invocation claims a few
 * items at a time until its time budget is spent, and any later invocation (continuation, next cron,
 * manual trigger) picks up whatever is still pending. `rdb` is the restricted refresh-role Db.
 */
export const ITEM_MAX_ATTEMPTS = 3;
export const STALE_ITEM_SECS = 300; // an item "running" this long belongs to a dead invocation
export const STALE_RUN_SECS = 600; // a run with no heartbeat this long is interrupted → resumable

export type StartState = "started" | "resumed" | "already_running" | "nothing_due";

export async function startRun(rdb: Db, trigger: "cron" | "manual", plan?: PlanOptions): Promise<{ run_id: string; state: StartState }> {
  const active = (await rdb.query<{ id: string; stale: boolean }>(
    `select id, heartbeat_at < now() - make_interval(secs => $1) as stale from runs where status = 'running'`,
    [STALE_RUN_SECS],
  )).rows[0];
  if (active) {
    if (!active.stale) return { run_id: active.id, state: "already_running" };
    await rdb.query(`update runs set heartbeat_at = now() where id = $1`, [active.id]);
    await rdb.query(
      `update run_items set status = 'pending', error = 'interrupted; resumed' where run_id = $1 and status = 'running'`,
      [active.id],
    );
    await rdb.query(`insert into audit_logs (run_id, level, event) values ($1, 'warn', 'run_resumed_after_interruption')`, [active.id]);
    return { run_id: active.id, state: "resumed" };
  }
  try {
    return await rdb.tx(async (q) => {
      // Without plan options every investor is searched (tests, ad-hoc use). Production passes a plan so that
      // free-tier search credits go where they are worth spending.
      const everyone = plan ? null : (await q.query<{ id: string }>(`select id from investors`)).rows.map((r) => r.id);
      const p = plan ? await planRun(q, plan) : { ids: everyone!, skipped: { recent: 0, cold: 0, budget: 0 }, cost: everyone!.length, remaining: null };
      const skipped = p.skipped.recent + p.skipped.cold + p.skipped.budget;
      const nothing = p.ids.length === 0;
      const run = (await q.query<{ id: string }>(
        `insert into runs (trigger_type, include_linkedin, skipped, plan, status, completed_at, summary)
         values ($1, $2, $3, $4::jsonb, $5, $6, $7) returning id`,
        [
          trigger, !!plan?.linkedin, skipped, JSON.stringify({ ...p.skipped, expected_searches: p.cost, credits_remaining_before: p.remaining }),
          nothing ? "succeeded" : "running", nothing ? new Date().toISOString() : null,
          nothing ? `Nothing due: ${skipped} investor${skipped === 1 ? " was" : "s were"} checked recently or are cold (no credits used)` : null,
        ],
      )).rows[0]!;
      if (!nothing) await q.query(`insert into run_items (run_id, investor_id) select $1, unnest($2::uuid[])`, [run.id, p.ids]);
      await q.query(`update runs set investors_total = $2 where id = $1`, [run.id, p.ids.length]);
      await q.query(`insert into audit_logs (run_id, event, detail) values ($1, 'run_started', $2::jsonb)`, [run.id, JSON.stringify({ trigger, investors: p.ids.length, skipped: p.skipped, expected_searches: p.cost, linkedin: !!plan?.linkedin })]);
      return { run_id: run.id, state: nothing ? ("nothing_due" as const) : ("started" as const) };
    });
  } catch (e) {
    // Lost a race with a concurrent start: the partial unique index guarantees a single active run.
    if (/runs_single_active|duplicate key/i.test(String((e as Error).message))) {
      const id = (await rdb.query<{ id: string }>(`select id from runs where status = 'running'`)).rows[0]?.id;
      if (id) return { run_id: id, state: "already_running" };
    }
    throw e;
  }
}

export interface ChunkOptions {
  budgetMs?: number;
  concurrency?: number;
  /** Don't start a new batch unless this much of the budget is left. */
  batchEstimateMs?: number;
  /** Hard cap on investors claimed by this invocation (bounds work independently of time). */
  maxItems?: number;
}

export interface ChunkResult {
  finished: boolean;
  remaining: number;
  status?: "succeeded" | "partial" | "failed";
}

export async function runChunk(rdb: Db, deps: Deps, runId: string, o: ChunkOptions = {}): Promise<ChunkResult> {
  const budget = o.budgetMs ?? 240_000;
  const concurrency = o.concurrency ?? 3;
  const estimate = o.batchEstimateMs ?? 45_000;
  const maxItems = o.maxItems ?? Infinity;
  const deadline = Date.now() + budget;
  let claimedTotal = 0;

  // The run decides whether LinkedIn is searched (an explicit deps.linkedin, as in tests, wins).
  if (deps.linkedin === undefined) {
    const flag = (await rdb.query<{ include_linkedin: boolean }>(`select include_linkedin from runs where id = $1`, [runId])).rows[0];
    deps = { ...deps, linkedin: !!flag?.include_linkedin };
  }

  await rdb.query(
    `update run_items set status = 'pending', error = 'interrupted; re-queued'
      where run_id = $1 and status = 'running' and started_at < now() - make_interval(secs => $2)`,
    [runId, STALE_ITEM_SECS],
  );

  while (claimedTotal < maxItems && Date.now() + estimate < deadline) {
    const claimed = (await rdb.query<{ investor_id: string; attempts: number }>(
      `update run_items set status = 'running', started_at = now(), attempts = attempts + 1
        where (run_id, investor_id) in (
          select run_id, investor_id from run_items where run_id = $1 and status = 'pending'
           order by attempts, investor_id limit $2 for update skip locked)
        returning investor_id, attempts`,
      [runId, Math.min(concurrency, maxItems - claimedTotal)],
    )).rows;
    if (claimed.length === 0) break;
    claimedTotal += claimed.length;
    await Promise.all(claimed.map((c) => processOne(rdb, deps, runId, c.investor_id, c.attempts)));
  }

  const left = (await rdb.query<{ n: number }>(`select count(*)::int as n from run_items where run_id = $1 and status in ('pending','running')`, [runId])).rows[0]!.n;
  if (left === 0) {
    const status = await finalizeRun(rdb, runId);
    await rescoreUnsearched(rdb, deps, runId);
    return { finished: true, remaining: 0, status };
  }
  await rdb.query(`update runs set heartbeat_at = now() where id = $1`, [runId]);
  return { finished: false, remaining: left };
}

async function processOne(rdb: Db, deps: Deps, runId: string, investorId: string, attempts: number): Promise<void> {
  let result: ItemResult = { ok: false, retryable: true, error: "unknown", counters: zeroCounters() };
  try {
    const inv = await loadInvestor(rdb, investorId); // explicit column list: the refresh role cannot read personal_notes / contact_history
    if (!inv) throw new Error("investor no longer exists");
    result = await processInvestor(rdb, deps, runId, inv);
  } catch (e) {
    result = { ok: false, retryable: true, error: `internal:${String((e as Error).message ?? e).slice(0, 200)}`, counters: zeroCounters() };
  }

  const terminal = result.ok || !result.retryable || attempts >= ITEM_MAX_ATTEMPTS;
  if (!result.ok) {
    await rdb.query(
      `update run_items set status = $3, error = $4, finished_at = case when $3 = 'failed' then now() end where run_id = $1 and investor_id = $2`,
      [runId, investorId, terminal ? "failed" : "pending", result.error],
    );
  }
  const c = result.counters;
  await rdb.query(
    `update runs set heartbeat_at = now(),
        investors_processed = investors_processed + $2, sources_checked = sources_checked + $3,
        signals_discovered = signals_discovered + $4, signals_accepted = signals_accepted + $5,
        duplicates_removed = duplicates_removed + $6, records_updated = records_updated + $7, search_calls = search_calls + $10,
        error_count = error_count + $8,
        error_details = case when $8 = 1 and jsonb_array_length(error_details) < 100
                             then error_details || $9::jsonb else error_details end
      where id = $1`,
    [
      runId, terminal ? 1 : 0, c.sources_checked, c.signals_discovered, c.signals_accepted, c.duplicates_removed, c.records_updated,
      result.ok ? 0 : 1,
      JSON.stringify([{ investor_id: investorId, attempt: attempts, error: result.error, final: terminal }]),
      c.search_calls,
    ],
  );
}

/**
 * Investors this run did not search (checked recently, "cold", or over the credit budget) keep their evidence, but their
 * recency has moved on. Re-score them from stored evidence (no search, no model) so every score reflects today. Failure
 * here is recorded and never affects the run's status: the searched investors were already scored.
 */
async function rescoreUnsearched(rdb: Db, deps: Deps, runId: string): Promise<void> {
  try {
    const searched = new Set((await rdb.query<{ investor_id: string }>(`select investor_id from run_items where run_id = $1`, [runId])).rows.map((r) => r.investor_id));
    const sum = await rescoreAll(rdb, deps.now(), { skip: searched });
    await rdb.query(`insert into audit_logs (run_id, event, detail) values ($1, 'rescored_unsearched', $2::jsonb)`, [runId, JSON.stringify(sum)]);
  } catch (e) {
    await rdb.query(`insert into audit_logs (run_id, level, event, detail) values ($1, 'warn', 'rescore_failed', $2::jsonb)`, [runId, JSON.stringify({ message: String((e as Error).message ?? e).slice(0, 200) })]).catch(() => {});
  }
}

/** Completes the run. Success is only ever claimed here, after every item has reached a final state. */
export async function finalizeRun(rdb: Db, runId: string): Promise<"succeeded" | "partial" | "failed"> {
  const c = (await rdb.query<{ done: number; failed: number }>(
    `select count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'failed')::int as failed
       from run_items where run_id = $1`,
    [runId],
  )).rows[0]!;
  const status = c.failed === 0 ? "succeeded" : c.done === 0 ? "failed" : "partial";
  const summary = `${c.done} investor${c.done === 1 ? "" : "s"} refreshed` + (c.failed ? `, ${c.failed} failed` : "");
  const r = await rdb.query(
    `update runs set status = $2, completed_at = now(), heartbeat_at = now(), summary = $3 where id = $1 and status = 'running'`,
    [runId, status, summary],
  );
  if (r.rowCount > 0) await rdb.query(`insert into audit_logs (run_id, event, detail) values ($1, 'run_completed', $2::jsonb)`, [runId, JSON.stringify({ status, ...c })]);
  return status;
}
