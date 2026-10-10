import Link from "next/link";
import { InvestorCard } from "@/components/InvestorCard";
import { RefreshButton } from "@/components/RefreshButton";
import { Card, Empty, PageTitle, SetupError, Stat } from "@/components/ui";
import { ACTION_LABEL, ago, fmtDateTime } from "@/lib/format";
import { load, today } from "@/lib/page";
import { getOverview, type PipelineRow } from "@/lib/read";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Priority queue · VC Pipeline Intelligence" } };

const HOLD = (r: PipelineRow) => r.recommended_action === "wait_for_response" || r.relationship_status === "passed" || r.relationship_status === "committed";

export default async function Overview() {
  const res = await load((db) => getOverview(db, today()));
  if (!res.ok) return <SetupError message={res.error} />;
  const { pipeline, counts, active, lastGood, runs } = res.data;

  const hold = pipeline.filter((r) => r.state === "active" && HOLD(r));
  const queue = pipeline
    .filter((r) => r.state === "active" && !HOLD(r) && r.recommended_action !== "no_action")
    .sort((a, b) => (b.follow_up_score ?? 0) - (a.follow_up_score ?? 0) || (b.last_signal_date ?? "").localeCompare(a.last_signal_date ?? ""));
  const never = runs.length === 0;
  const unknown = counts.failed + counts.review;

  return (
    <>
      <PageTitle
        title="Who to contact this week"
        sub="Investors ranked by a transparent follow-up score. Every recommendation links to the public evidence behind it; investors with no verified signal are listed, not hidden."
      >
        <RefreshButton />
      </PageTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tracked investors" value={counts.total} href="/pipeline" />
        <Stat label="Active signal (30 d)" value={counts.active} tone="good" hint="verified & relevant" href="/pipeline?state=active" />
        <Stat label="No verified signal" value={counts.quiet} hint="search completed" href="/quiet" />
        <Stat label="Needs review / failed" value={unknown} tone={unknown ? "warn" : undefined} hint="activity unknown — not 'quiet'" href="/quiet" />
      </div>

      <Card className="mt-3 p-4 text-sm">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <span className="text-muted">Current run: </span>
            <span className="font-medium">
              {active ? `running — ${active.investors_processed} of ${active.investors_total} investors` : never ? "none yet" : `idle (last ${runs[0]!.status})`}
            </span>
          </div>
          <div>
            <span className="text-muted">Last successful refresh: </span>
            <span className="font-medium">{lastGood ? `${fmtDateTime(lastGood.completed_at)} (${ago(lastGood.completed_at)})` : "never"}</span>
          </div>
        </div>
        {active && (
          <div className="mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={active.investors_total} aria-valuenow={active.investors_processed} aria-label="Refresh progress">
            <div className="h-2 overflow-hidden rounded-full bg-neutral-soft">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round((active.investors_processed / Math.max(1, active.investors_total)) * 100)}%` }} />
            </div>
          </div>
        )}
      </Card>

      {unknown > 0 && !never && (
        <div role="note" className="mt-3 rounded-xl border border-warn bg-warn-soft p-4 text-sm text-warn">
          <strong>{unknown} investor{unknown > 1 ? "s" : ""} could not be fully checked.</strong> Their activity is <em>unknown</em>, not absent — a failed search is never treated as a quiet investor.{" "}
          <Link href="/quiet" className="font-medium underline">See which and why</Link>.
        </div>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">Priority queue {queue.length > 0 && <span className="text-sm font-normal text-muted">· {queue.length} to act on</span>}</h2>
      {never ? (
        <Empty
          title="No refresh has run yet"
          action={<RefreshButton label="Run the first refresh" />}
        >
          {counts.total} investors are imported. The first refresh searches public sources for activity in the last 30 days and scores each investor. Until then there is nothing to rank — no placeholder results are shown.
        </Empty>
      ) : queue.length === 0 ? (
        <Empty title="Nobody has a strong, relevant signal right now">
          That is a result, not an error. Check <Link href="/quiet" className="underline">quiet investors</Link> to see what was searched and what couldn't be, or wait for the next scheduled refresh.
        </Empty>
      ) : (
        <div className="space-y-3">
          {queue.map((r, i) => (
            <InvestorCard key={r.id} r={r} rank={i + 1} />
          ))}
        </div>
      )}

      {hold.length > 0 && (
        <>
          <h2 className="mb-1 mt-8 text-lg font-semibold">Don't chase this week</h2>
          <p className="mb-3 text-sm text-muted">These have a fresh signal, but your relationship status says to hold off.</p>
          <div className="space-y-3">
            {hold.map((r) => (
              <InvestorCard key={r.id} r={r} />
            ))}
          </div>
        </>
      )}

      {!never && (
        <p className="mt-8 text-sm text-muted">
          Recommendations use: {Object.values(ACTION_LABEL).join(" · ")}. Open any investor for the full evidence timeline and score breakdown.
        </p>
      )}
    </>
  );
}
