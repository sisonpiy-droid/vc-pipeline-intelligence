import type { Db } from "@/lib/db";
import { AiError } from "@/lib/ai/gemini";
import { ProviderError } from "@/lib/providers/types";
import type { Deps } from "./research";

/**
 * Provider telemetry: how long every external call took and how it ended. Measured at the dependency boundary, so the
 * pipeline code is unchanged and tests can inject doubles as before. The result feeds the provider-health table on the
 * run page; nothing here can influence a score, and a telemetry failure never fails an investor.
 */
export interface CallRecord {
  provider: string;
  ok: boolean;
  category: string | null;
  ms: number;
}

const categoryOf = (e: unknown): string => (e instanceof ProviderError || e instanceof AiError ? e.category : "error");

export function instrument(deps: Deps, sink: (r: CallRecord) => void): Deps {
  async function timed<T>(provider: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    try {
      const out = await fn();
      sink({ provider, ok: true, category: null, ms: Date.now() - t0 });
      return out;
    } catch (e) {
      sink({ provider, ok: false, category: categoryOf(e), ms: Date.now() - t0 });
      throw e;
    }
  }
  return {
    ...deps,
    search: { ...deps.search, name: deps.search.name, search: (q) => timed(deps.search.name, () => deps.search.search(q)) },
    pages: { ...deps.pages, fetch: (url) => timed("page_fetch", () => deps.pages.fetch(url)) },
    ai: { ...deps.ai, generateJson: (req) => timed("gemini", () => deps.ai.generateJson(req)) },
  };
}

/** One multi-row insert per investor. Errors are swallowed: telemetry is best effort by design. */
export async function flushCalls(rdb: Db, runId: string, calls: CallRecord[]): Promise<void> {
  if (calls.length === 0) return;
  try {
    await rdb.query(
      `insert into provider_calls (run_id, provider, ok, category, ms)
       select $1, p, o, c, m from unnest($2::text[], $3::boolean[], $4::text[], $5::int[]) as t(p, o, c, m)`,
      [runId, calls.map((c) => c.provider), calls.map((c) => c.ok), calls.map((c) => c.category), calls.map((c) => c.ms)],
    );
  } catch {
    /* best effort */
  }
}

export interface ProviderHealth {
  provider: string;
  calls: number;
  failed: number;
  p50_ms: number;
  p95_ms: number;
  last_call: string;
  top_errors: { category: string; n: number }[];
}

/** Provider health over the last `days` days, from the measured calls. */
export async function getProviderHealth(db: Db, days = 7): Promise<ProviderHealth[]> {
  const rows = (await db.query<{ provider: string; calls: number; failed: number; p50: number; p95: number; last_call: string }>(
    `select provider, count(*)::int as calls, count(*) filter (where not ok)::int as failed,
            round(percentile_cont(0.5) within group (order by ms))::int as p50,
            round(percentile_cont(0.95) within group (order by ms))::int as p95,
            max(at)::text as last_call
       from provider_calls where at >= now() - make_interval(days => $1) group by provider order by provider`,
    [days],
  )).rows;
  const errs = (await db.query<{ provider: string; category: string; n: number }>(
    `select provider, coalesce(category, 'error') as category, count(*)::int as n
       from provider_calls where not ok and at >= now() - make_interval(days => $1) group by 1, 2 order by n desc`,
    [days],
  )).rows;
  return rows.map((r) => ({
    provider: r.provider, calls: r.calls, failed: r.failed, p50_ms: r.p50, p95_ms: r.p95, last_call: r.last_call,
    top_errors: errs.filter((e) => e.provider === r.provider).slice(0, 3).map((e) => ({ category: e.category, n: e.n })),
  }));
}
