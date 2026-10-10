import { getDb } from "@/lib/db";
import { ago, fmtDateTime } from "@/lib/format";
import { getRunBar } from "@/lib/read";
import { nextScheduledRun } from "@/lib/schedule";
import { AutoRefresh } from "./AutoRefresh";
import { Pill } from "./ui";

const STALE_MS = 10 * 60_000;

/** Global status strip: what is running, when data was last refreshed, when it refreshes next. */
export async function RunBar() {
  let d: Awaited<ReturnType<typeof getRunBar>>;
  try {
    d = await getRunBar(getDb());
  } catch {
    return null; // pages show the actual error; the strip just stays quiet
  }
  const now = new Date();
  const stalled = d.active && now.getTime() - new Date(d.active.heartbeat_at).getTime() > STALE_MS;
  return (
    <div className="border-b border-line bg-surface text-sm">
      <AutoRefresh active={!!d.active && !stalled} />
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-muted">Run</span>
          {d.active ? (
            stalled ? (
              <Pill tone="bad">Stalled — no progress for {ago(d.active.heartbeat_at, now).replace(" ago", "")}</Pill>
            ) : (
              <Pill tone="info">Running {d.active.investors_processed}/{d.active.investors_total}</Pill>
            )
          ) : d.latest ? (
            <Pill tone={d.latest.status === "succeeded" ? "good" : d.latest.status === "partial" ? "warn" : "bad"}>
              {d.latest.status === "succeeded" ? "Last run succeeded" : d.latest.status === "partial" ? "Last run partial" : "Last run failed"}
            </Pill>
          ) : (
            <Pill tone="neutral">No run yet</Pill>
          )}
        </div>
        <div>
          <span className="text-muted">Last successful refresh </span>
          {d.lastGood ? (
            <span className="font-medium">
              {fmtDateTime(d.lastGood.completed_at)} <span className="font-normal text-muted">({ago(d.lastGood.completed_at, now)}{d.lastGood.status === "partial" ? ", partial" : ""})</span>
            </span>
          ) : (
            <span className="font-medium">never</span>
          )}
        </div>
        <div>
          <span className="text-muted">Next scheduled </span>
          <span className="font-medium">{fmtDateTime(nextScheduledRun(now))}</span>
          <span className="text-muted"> (Mon &amp; Thu, ±1 h)</span>
        </div>
      </div>
    </div>
  );
}
