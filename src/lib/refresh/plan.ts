import type { Queryable } from "@/lib/db";

/**
 * Decides WHICH investors a run searches, so a free-tier search quota is spent where it is worth spending.
 * Skipping is never a verdict: skipped investors get no run_item, keep their previous values, and their
 * "checked N days ago" freshness stays honest. Nothing here can make an investor look "quiet".
 *
 * Rules, in order:
 *  1. Investors whose last check was less than `recentHours` ago (and succeeded) are skipped: re-checking
 *     them minutes after a refresh would only burn credits (e.g. a manual run right after the cron run).
 *  2. "Cold" investors (their last two checks both found nothing relevant) are searched about weekly rather than
 *     on every run. With twice-weekly runs that is every other run.
 *  3. If a monthly credit budget is set, what remains is searched in priority order until the credits run out:
 *     investors with an active signal first, then retries after failures, then never-checked, then stalest.
 */
export interface PlanOptions {
  /** Monthly search-credit cap. Undefined = no cap. */
  creditBudget?: number;
  /** Credits spent outside tracked runs (probes, live checks, a shared key). */
  creditsBaseline?: number;
  /** Each investor costs 2 searches instead of 1. */
  linkedin?: boolean;
  /** Skip investors checked within this many hours. Default 36. 0 disables. */
  recentHours?: number;
  /** Search "cold" investors only this often. Default 6.5 days. 0 disables. */
  coldDays?: number;
  now?: Date;
}

export interface RunPlan {
  ids: string[];
  skipped: { recent: number; cold: number; budget: number };
  /** Searches this run is expected to make. */
  cost: number;
  /** Credits left in the month before this run, or null if uncapped. */
  remaining: number | null;
}

interface Row {
  id: string;
  follow_up_score: number | null;
  last_at: Date | string | null;
  last_status: string | null;
  cold: boolean;
  active: boolean;
  checked: number;
}

export async function planRun(q: Queryable, o: PlanOptions = {}): Promise<RunPlan> {
  const now = (o.now ?? new Date()).getTime();
  const recentMs = (o.recentHours ?? 36) * 3_600_000;
  const coldMs = (o.coldDays ?? 6.5) * 86_400_000;
  const per = o.linkedin ? 2 : 1;

  const rows = (await q.query<Row>(
    `with ranked as (
       select investor_id, status, finished_at, outcome,
              row_number() over (partition by investor_id order by finished_at desc nulls last) as rn
         from run_items where status in ('done', 'failed')
     )
     select i.id, i.follow_up_score,
            max(r.finished_at) filter (where r.rn = 1) as last_at,
            max(r.status)      filter (where r.rn = 1) as last_status,
            coalesce(bool_and(r.status = 'done' and coalesce((r.outcome->>'relevant_signals')::int, 0) = 0) filter (where r.rn <= 2) and count(r.rn) >= 2, false) as cold,
            coalesce(bool_or(coalesce((r.outcome->>'relevant_signals')::int, 0) > 0) filter (where r.rn = 1), false) as active,
            count(r.rn)::int as checked
       from investors i left join ranked r on r.investor_id = i.id and r.rn <= 2
      where not i.is_demo
      group by i.id, i.follow_up_score`,
  )).rows;

  const skipped = { recent: 0, cold: 0, budget: 0 };
  const due: Row[] = [];
  for (const r of rows) {
    const age = r.last_at ? now - new Date(r.last_at).getTime() : Infinity;
    if (r.last_status === "done" && recentMs > 0 && age < recentMs) { skipped.recent++; continue; }
    if (r.cold && r.last_status === "done" && coldMs > 0 && age < coldMs) { skipped.cold++; continue; }
    due.push(r);
  }

  // Priority: active signal (best score first) > retry after failure > never checked > stalest check.
  const rank = (r: Row) => (r.active ? 0 : r.last_status === "failed" ? 1 : r.checked === 0 ? 2 : 3);
  due.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.follow_up_score ?? -1) - (a.follow_up_score ?? -1) ||
      (a.last_at ? new Date(a.last_at).getTime() : 0) - (b.last_at ? new Date(b.last_at).getTime() : 0) ||
      a.id.localeCompare(b.id),
  );

  let remaining: number | null = null;
  let chosen = due;
  if (o.creditBudget !== undefined) {
    const used = (await q.query<{ n: number }>(
      `select coalesce(sum(search_calls), 0)::int as n from runs where started_at >= date_trunc('month', now())`,
    )).rows[0]!.n;
    remaining = Math.max(0, o.creditBudget - (o.creditsBaseline ?? 0) - used);
    const fit = Math.floor(remaining / per);
    chosen = due.slice(0, fit);
    skipped.budget = due.length - chosen.length;
  }
  return { ids: chosen.map((r) => r.id), skipped, cost: chosen.length * per, remaining };
}
