import { createGemini } from "@/lib/ai/gemini";
import type { Db } from "@/lib/db";
import { createPageFetcher } from "@/lib/providers/fetchPage";
import { createTavily } from "@/lib/providers/tavily";
import type { Deps } from "./research";
import { runChunk, startRun, type ChunkOptions, type StartState } from "./run";

/** Real providers. Credentials are read from the environment at call time, so a missing key is a typed run error, not a crash. */
export function productionDeps(): Deps {
  return { search: createTavily(), pages: createPageFetcher(), ai: createGemini(), now: () => new Date() };
}

/** A manual refresh costs search credits and Gemini calls; one per 10 minutes is plenty for a human. */
export const MANUAL_COOLDOWN_MIN = 10;

export type TriggerResult = { run_id: string; state: StartState } | { state: "throttled"; retry_after_s: number };

export async function triggerRefresh(rdb: Db, trigger: "cron" | "manual"): Promise<TriggerResult> {
  if (trigger === "manual") {
    const active = (await rdb.query(`select 1 from runs where status = 'running'`)).rowCount > 0;
    if (!active) {
      const wait = (await rdb.query<{ wait: number }>(
        `select ceil(extract(epoch from (started_at + make_interval(mins => $1) - now())))::int as wait
           from runs where trigger_type = 'manual' order by started_at desc limit 1`,
        [MANUAL_COOLDOWN_MIN],
      )).rows[0]?.wait;
      if (wait !== undefined && wait > 0) return { state: "throttled", retry_after_s: wait };
    }
  }
  return startRun(rdb, trigger);
}

export const MAX_CHAIN = 20; // 82 investors ≈ 3 chunks; this only stops a runaway loop

/**
 * One invocation's share of the work: process what fits in the time budget, then, if investors remain,
 * ask a *new* invocation to continue (its own time budget). If that hand-off is lost, the run's
 * heartbeat goes stale and the next cron / manual trigger resumes it.
 */
export async function work(rdb: Db, deps: Deps, runId: string, origin: string, chain = 0, opts: ChunkOptions = { budgetMs: 240_000 }): Promise<void> {
  const chunk = await runChunk(rdb, deps, runId, opts);
  if (chunk.finished || chain >= MAX_CHAIN) return;
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  await fetch(`${origin}/api/refresh/continue`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ run_id: runId, chain: chain + 1 }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {}); // lost hand-off is recoverable (see above)
}
