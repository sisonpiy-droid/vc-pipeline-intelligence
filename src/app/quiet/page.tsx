import Link from "next/link";
import { ClickableRow } from "@/components/ClickableRow";
import { isDemoView } from "@/lib/demoData/mode";
import { Card, Empty, PageTitle, Pill, SetupError } from "@/components/ui";
import { ENTITY_LABEL, ago, explainError, fmtDate } from "@/lib/format";
import { load, today } from "@/lib/page";
import { listPipeline, type InvestorState, type PipelineRow } from "@/lib/read";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quiet investors" };

/** The distinctions the brief insists on. Order = how much attention each group deserves. */
const GROUPS: { state: InvestorState; title: string; tone: "bad" | "warn" | "neutral"; blurb: string }[] = [
  { state: "failed", title: "Search failed", tone: "bad", blurb: "The latest refresh could not complete for these investors, so we do NOT know whether they are active. Their previous scores are unchanged. This is not inactivity." },
  { state: "quiet_partial", title: "Some sources checked — coverage incomplete", tone: "warn", blurb: "Nothing relevant was found, but at least one source failed or was unavailable (for example a page that could not be fetched). Absence of a signal is not conclusive." },
  { state: "not_checked", title: "Not checked yet", tone: "warn", blurb: "No refresh has completed for these investors (for example they were imported after the last run)." },
  { state: "stale", title: "Older signals only", tone: "neutral", blurb: "Every source answered. Nothing relevant in the last 30 days, but the investor had a relevant signal before that window." },
  { state: "quiet_complete", title: "Searched — no relevant signal found", tone: "neutral", blurb: "Every source answered successfully and found nothing relevant in the last 30 days. These are genuinely quiet." },
];

function Row({ r }: { r: PipelineRow }) {
  const err = r.state === "failed" ? explainError(r.last_error) : null;
  return (
    <ClickableRow as="li" href={`/investors/${r.id}`} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1 px-4 py-3 hover:bg-neutral-soft/50">
      <div className="min-w-0">
        <Link href={`/investors/${r.id}`} className="font-medium hover:underline">{r.firm_name}</Link>
        <span className="ml-2 text-xs text-muted">{ENTITY_LABEL[r.entity_type]}</span>
        {err && (
          <p className="mt-1 text-sm">
            <span className="font-medium text-bad">{err.title}.</span> <span className="text-muted">{err.action}</span>
          </p>
        )}
        {r.state === "stale" && r.last_signal_date && <p className="mt-1 text-sm text-muted">Most recent relevant signal: {fmtDate(r.last_signal_date)}</p>}
        {r.state === "quiet_partial" && <p className="mt-1 text-sm text-muted">Open the investor to see which source was incomplete.</p>}
      </div>
      <div className="text-right text-xs text-muted">
        {r.last_checked ? <>Last checked {ago(r.last_checked)}</> : "Never checked"}
        {r.follow_up_score !== null && <div>Score {r.follow_up_score} (unchanged)</div>}
      </div>
    </ClickableRow>
  );
}

export default async function Quiet() {
  const demo = await isDemoView();
  const res = await load((db) => listPipeline(db, today(), demo));
  if (!res.ok) return <SetupError message={res.error} />;
  const rows = res.data.filter((r) => r.state !== "active");
  const by = (s: InvestorState) => rows.filter((r) => r.state === s).sort((a, b) => a.firm_name.localeCompare(b.firm_name));

  return (
    <>
      <PageTitle
        title="Quiet investors"
        sub={`${rows.length} of ${res.data.length} tracked investors have no verified relevant signal in the last 30 days. They are all listed, grouped by what we actually know.`}
      />
      {rows.length === 0 ? (
        <Empty title="Every tracked investor has an active signal">Nothing to show here.</Empty>
      ) : (
        <div className="space-y-5">
          {GROUPS.map((g) => {
            const list = by(g.state);
            if (list.length === 0) return null;
            return (
              <Card key={g.state}>
                <div className="border-b border-line p-4">
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    {g.title} <Pill tone={g.tone}>{list.length}</Pill>
                  </h2>
                  <p className="mt-1 text-sm text-muted">{g.blurb}</p>
                </div>
                <ul className="divide-y divide-line">{list.map((r) => <Row key={r.id} r={r} />)}</ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
