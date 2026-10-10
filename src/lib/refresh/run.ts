import type { Db } from "@/lib/db";
import { processInvestor, zeroCounters, type ItemResult } from "./process";
import type { Deps, InvestorRow } from "./research";

/**
 * Run lifecycle. A "run" is a row in `runs` plus one `run_items` row per investor — a durable queue.
 * Nothing here assumes a single invocation can finish the whole job: each invocation claims a few
 * items at a time until its time budget is spent, and any later invocation (continuation, next cron,
 * manual trigger) picks up whatever is still pending. `rdb` is the restricted refresh-role Db.
 */
export const ITEM_MAX_ATTEMPTS = 3;
export const STALE_ITEM_SECS = 300; // an item "running" this long belongs to a dead invocation
export const STALE_RUN_SECS = 600; // a run with no heartbeat this long is interrupted → resumable

export type StartState = "started" | "resumed" | "already_running";

export async function startRun(rdb: Db, trigger: "cron" | "manual"): Promise<{ run_id: string; state: StartState }> {
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
      const run = (await q.query<{ id: string }>(`insert into runs (trigger_type) values ($1) returning id`, [trigger])).rows[0]!;
      const n = await q.query(`insert into run_items (run_id, investor_id) select $1, id from investors`, [run.id]);
      await q.query(`update runs set investors_total = $2 where id = $1`, [run.id, n.rowCount]);
      await q.query(`insert into audit_logs (run_id, event, detail) values ($1, 'run_started', $2::jsonb)`, [run.id, JSON.stringify({ trigger, investors: n.rowCount })]);
      return { run_id: run.id, state: "started" as const };
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
    return { finished: true, remaining: 0, status };
  }
  await rdb.query(`update runs set heartbeat_at = now() where id = $1`, [runId]);
  return { finished: false, remaining: left };
}

async function processOne(rdb: Db, deps: Deps, runId: string, investorId: string, attempts: number): Promise<void> {
  let result: ItemResult = { ok: false, retryable: true, error: "unknown", counters: zeroCounters() };
  try {
    // Explicit column list: the refresh role cannot (and must not) read personal_notes / contact_history.
    const inv = (await rdb.query<InvestorRow>(
      `select id, firm_name, aliases, entity_type, role_title, partner_name, website_url, stage_preference, sectors, geography,
              fit_rationale, investment_thesis, relationship_status, last_contact_date::text as last_contact_date
         from investors where id = $1`,
      [investorId],
    )).rows[0];
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
        duplicates_removed = duplicates_removed + $6, records_updated = records_updated + $7,
        error_count = error_count + $8,
        error_details = case when $8 = 1 and jsonb_array_length(error_details) < 100
                             then error_details || $9::jsonb else error_details end
      where id = $1`,
    [
      runId, terminal ? 1 : 0, c.sources_checked, c.signals_discovered, c.signals_accepted, c.duplicates_removed, c.records_updated,
      result.ok ? 0 : 1,
      JSON.stringify([{ investor_id: investorId, attempt: attempts, error: result.error, final: terminal }]),
    ],
  );
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
