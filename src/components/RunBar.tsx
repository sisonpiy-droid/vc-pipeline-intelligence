import { getDb } from "@/lib/db";
import { ago, fmtDateTime } from "@/lib/format";
import { getRunBar } from "@/lib/read";
import { nextScheduledRun } from "@/lib/schedule";
import { AutoRefresh } from "./AutoRefresh";
import { Pill } from "./ui";

const STALE_MS = 10 * 60_000;

/** Global status strip: what is running, when data was last refreshed, when it refreshes next. */
export async function RunBar({ demo = false }: { demo?: boolean }) {
  let d: Awaited<ReturnType<typeof getRunBar>>;
  try {
    d = await getRunBar(getDb(), demo);
  } catch {
    return null; // pages show the actual error; the strip just stays quiet
  }
  const now = new Date();
  const stalled = d.active && now.getTime() - new Date(d.active.heartbeat_at).getTime() > STALE_MS;
  const Item = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div className="flex items-baseline gap-2">
      <span className="num text-[0.65rem] uppercase tracking-[0.12em] text-muted">{k}</span>
      <span>{children}</span>
    </div>
  );
  return (
    <div className="border-b border-line text-[0.8rem]">
      <AutoRefresh active={!!d.active && !stalled} />
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-1.5 px-4 py-2.5 sm:px-8">
        <Item k="Run">
          {d.active ? (
            stalled ? (
              <Pill tone="bad">Stalled — no progress for {ago(d.active.heartbeat_at, now).replace(" ago", "")}</Pill>
            ) : (
              <span className="inline-flex items-center gap-2 font-medium">
                <span aria-hidden className="beacon relative h-2 w-2 rounded-full bg-accent text-accent" />
                Running <span className="num">{d.active.investors_processed}/{d.active.investors_total}</span>
              </span>
            )
          ) : d.latest ? (
            <Pill tone={d.latest.status === "succeeded" ? "good" : d.latest.status === "partial" ? "warn" : "bad"}>
              {demo ? "Last simulated run " : "Last run "}{d.latest.status === "succeeded" ? "succeeded" : d.latest.status === "partial" ? "partial" : "failed"}
            </Pill>
          ) : (
            <Pill tone="neutral">No run yet</Pill>
          )}
        </Item>
        <Item k="Last refresh">
          {d.lastGood ? (
            <span className="font-medium">
              {fmtDateTime(d.lastGood.completed_at)} <span className="font-normal text-muted">· {ago(d.lastGood.completed_at, now)}{d.lastGood.status === "partial" ? ", partial" : ""}</span>
            </span>
          ) : (
            <span className="font-medium">never</span>
          )}
        </Item>
        <Item k="Next">
          {demo ? <span className="font-medium text-muted">none: demo runs are simulated on request</span> : <><span className="font-medium">{fmtDateTime(nextScheduledRun(now))}</span><span className="text-muted"> · Mon &amp; Thu, ±1 h</span></>}
        </Item>
      </div>
    </div>
  );
}
