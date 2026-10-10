import Link from "next/link";
import { RefreshButton } from "@/components/RefreshButton";
import { Card, Empty, PageTitle, Pill, SetupError, Stat } from "@/components/ui";
import { ago, explainError, fmtDateTime } from "@/lib/format";
import { load } from "@/lib/page";
import { getCoverageSummary, getFailedItems, listAudit, listRuns, type RunRow } from "@/lib/read";
import { CRON_SCHEDULE, nextScheduledRun } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const metadata = { title: "Runs & audit" };

const TONE = { succeeded: "good", partial: "warn", failed: "bad", running: "info" } as const;
const duration = (r: RunRow) => {
  if (!r.completed_at) return "—";
  const s = Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000);
  return s < 90 ? `${s}s` : `${Math.round(s / 60)} min`;
};

export default async function Runs() {
  const res = await load(async (db) => {
    const runs = await listRuns(db, 25);
    return { runs, coverage: await getCoverageSummary(db), audit: await listAudit(db, 40), failed: runs[0] ? await getFailedItems(db, runs[0].id) : [] };
  });
  if (!res.ok) return <SetupError message={res.error} />;
  const { runs, coverage, audit, failed } = res.data;
  const latest = runs[0];
  const lastGood = runs.find((r) => r.status === "succeeded" || r.status === "partial");
  const sources = [...new Set(coverage.map((c) => c.source))];
  const statuses = ["ok", "empty", "error", "skipped"];

  return (
    <>
      <PageTitle title="Run monitoring & audit" sub="Every refresh, what it queried, what it found, and what went wrong. Success is only reported after every investor has finished.">
        <RefreshButton />
      </PageTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Latest run" value={latest ? <Pill tone={TONE[latest.status as keyof typeof TONE]}>{latest.status}</Pill> : "—"} hint={latest ? `${latest.trigger_type}, ${ago(latest.started_at)}` : "none yet"} />
        <Stat label="Last successful run" value={lastGood?.completed_at ? ago(lastGood.completed_at) : "never"} hint={lastGood?.completed_at ? fmtDateTime(lastGood.completed_at) : undefined} />
        <Stat label="Next scheduled" value={fmtDateTime(nextScheduledRun(new Date())).slice(0, 11)} hint={`cron ${CRON_SCHEDULE} (UTC) · Vercel Hobby may start up to ~1 h late`} />
        <Stat label="Errors in latest run" value={latest?.error_count ?? 0} tone={latest?.error_count ? "bad" : undefined} hint={latest ? `${failed.length} investor${failed.length === 1 ? "" : "s"} failed after retries` : undefined} />
      </div>

      {failed.length > 0 && (
        <>
          <h2 className="mb-1 mt-8 text-lg font-semibold">Failures in the latest run</h2>
          <p className="mb-3 text-sm text-muted">Each failed investor kept its previous score; nothing was marked quiet. Items are retried up to 3 times within a run and again on the next one.</p>
          <Card className="divide-y divide-line">
            {failed.map((f) => {
              const e = explainError(f.error);
              return (
                <div key={f.investor_id} className="p-4 text-sm">
                  <Link href={`/investors/${f.investor_id}`} className="font-medium hover:underline">{f.firm_name}</Link>
                  <span className="ml-2 text-xs text-muted">{f.attempts} attempt{f.attempts === 1 ? "" : "s"}</span>
                  <p className="mt-1"><span className="font-medium text-bad">{e.title}.</span> <span className="text-muted">{e.action}</span></p>
                </div>
              );
            })}
          </Card>
        </>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">Run history</h2>
      {runs.length === 0 ? (
        <Empty title="No runs yet">Trigger a refresh above, or wait for the next scheduled run.</Empty>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[62rem] text-left text-sm">
            <caption className="sr-only">Refresh run history</caption>
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                {["Started", "Trigger", "Status", "Duration", "Investors", "Sources queried", "Evidence found", "Accepted", "Duplicates removed", "Records updated", "Errors"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium first:px-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {runs.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="px-4 py-2 font-normal">{fmtDateTime(r.started_at)}</th>
                  <td className="px-3 py-2">{r.trigger_type}</td>
                  <td className="px-3 py-2"><Pill tone={TONE[r.status as keyof typeof TONE]}>{r.status}</Pill></td>
                  <td className="px-3 py-2">{duration(r)}</td>
                  <td className="px-3 py-2">{r.investors_processed}/{r.investors_total}</td>
                  <td className="px-3 py-2">{r.sources_checked}</td>
                  <td className="px-3 py-2">{r.signals_discovered}</td>
                  <td className="px-3 py-2">{r.signals_accepted}</td>
                  <td className="px-3 py-2">{r.duplicates_removed}</td>
                  <td className="px-3 py-2">{r.records_updated}</td>
                  <td className="px-3 py-2">{r.error_count || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">Source coverage (latest check per investor)</h2>
      {sources.length === 0 ? (
        <Empty title="No coverage recorded yet" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <caption className="sr-only">How many investors each source answered for, by outcome</caption>
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr><th scope="col" className="px-4 py-2 font-medium">Source</th>{statuses.map((s) => <th key={s} scope="col" className="px-3 py-2 font-medium">{s === "empty" ? "searched, nothing found" : s}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {sources.map((src) => (
                <tr key={src}>
                  <th scope="row" className="px-4 py-2 font-medium">{src.replace(/_/g, " ")}</th>
                  {statuses.map((s) => {
                    const n = coverage.find((c) => c.source === src && c.status === s)?.n ?? 0;
                    return <td key={s} className={`px-3 py-2 ${s === "error" && n ? "font-semibold text-bad" : n ? "" : "text-muted"}`}>{n || "–"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <h2 className="mb-1 mt-8 text-lg font-semibold">Audit log</h2>
      <p className="mb-3 text-sm text-muted">Recent system events. Entries record outcomes and field names, never notes or contact history.</p>
      {audit.length === 0 ? (
        <Empty title="No audit events yet" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Recent audit events</caption>
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr><th scope="col" className="px-4 py-2 font-medium">When</th><th scope="col" className="px-3 py-2 font-medium">Level</th><th scope="col" className="px-3 py-2 font-medium">Event</th><th scope="col" className="px-3 py-2 font-medium">Investor</th><th scope="col" className="px-3 py-2 font-medium">Detail</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-muted">{fmtDateTime(a.at)}</td>
                  <td className="px-3 py-2"><Pill tone={a.level === "error" ? "bad" : a.level === "warn" ? "warn" : "neutral"}>{a.level}</Pill></td>
                  <td className="px-3 py-2 font-medium">{a.event.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2">{a.firm_name ?? "—"}</td>
                  <td className="max-w-md truncate px-3 py-2 text-xs text-muted" title={JSON.stringify(a.detail)}>{JSON.stringify(a.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
