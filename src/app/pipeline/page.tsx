import Link from "next/link";
import { Fresh } from "@/components/Fresh";
import { Card, Empty, PageTitle, Pill, SetupError } from "@/components/ui";
import { ACTION_LABEL, ACTION_TONE, ENTITY_LABEL, REL_LABEL, STATE_META, TYPE_LABEL, fmtDate } from "@/lib/format";
import { load, pick, today } from "@/lib/page";
import { PRIORITY, displayStatus, filterPipeline, listPipeline, sectorOptions } from "@/lib/read";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pipeline" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const SELECT = "w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm";

function Field({ label, name, value, children }: { label: string; name: string; value?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted">
      {label}
      <select name={name} defaultValue={value ?? ""} className={`${SELECT} mt-1 text-ink`}>
        {children}
      </select>
    </label>
  );
}

export default async function Pipeline({ searchParams }: Props) {
  const f = pick(await searchParams, ["q", "entity", "sector", "stage", "relationship", "category", "freshness", "priority", "state", "action", "sort"]);
  const res = await load((db) => listPipeline(db, today()));
  if (!res.ok) return <SetupError message={res.error} />;
  const all = res.data;
  const rows = filterPipeline(all, f, today());
  const filtered = Object.entries(f).some(([k, v]) => v && k !== "sort");

  return (
    <>
      <PageTitle title="Investor pipeline" sub={`${rows.length} of ${all.length} tracked investors. Statuses separate a quiet investor (searched, nothing found) from one we could not check.`} />

      <form method="get" className="mb-4 rounded-xl border border-line bg-surface p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          <label className="col-span-2 block text-xs font-medium text-muted md:col-span-2">
            Search
            <input name="q" defaultValue={f.q ?? ""} placeholder="Firm or person" className={`${SELECT} mt-1 text-ink`} />
          </label>
          <Field label="Status" name="state" value={f.state}>
            <option value="">All</option>
            <option value="active">Active signal</option>
            <option value="quiet">Quiet</option>
            <option value="review">Needs review</option>
            <option value="failed">Failed refresh</option>
          </Field>
          <Field label="Recommended action" name="action" value={f.action}>
            <option value="">All</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Field>
          <Field label="Priority" name="priority" value={f.priority}>
            <option value="">All</option>
            <option value="high">High ({PRIORITY.high}+)</option>
            <option value="medium">Medium ({PRIORITY.medium}–{PRIORITY.high - 1})</option>
            <option value="low">Low (&lt;{PRIORITY.medium})</option>
            <option value="unscored">Not scored</option>
          </Field>
          <Field label="Type" name="entity" value={f.entity}>
            <option value="">All</option>
            {Object.entries(ENTITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Field>
          <Field label="Sector" name="sector" value={f.sector}>
            <option value="">All</option>
            {sectorOptions(all).map((s) => <option key={s} value={s}>{s}</option>)}
          </Field>
          <Field label="Stage" name="stage" value={f.stage}>
            <option value="">All</option>
            <option value="seed">Seed / pre-seed / angel</option>
            <option value="early">Early stage</option>
            <option value="growth">Growth / Series A+</option>
            <option value="unknown">Unknown</option>
          </Field>
          <Field label="Relationship" name="relationship" value={f.relationship}>
            <option value="">All</option>
            {Object.entries(REL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Field>
          <Field label="Signal category" name="category" value={f.category}>
            <option value="">All</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Field>
          <Field label="Signal freshness" name="freshness" value={f.freshness}>
            <option value="">Any</option>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="none">No signal in window</option>
          </Field>
          <Field label="Sort by" name="sort" value={f.sort}>
            <option value="">Follow-up score</option>
            <option value="recent">Latest signal date</option>
            <option value="name">Name</option>
          </Field>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white dark:text-black">Apply</button>
          {filtered && <Link href="/pipeline" className="rounded-md border border-line px-4 py-1.5 text-sm">Reset</Link>}
        </div>
      </form>

      {rows.length === 0 ? (
        <Empty title="No investors match these filters">
          {all.length === 0 ? "No investors have been imported yet (npm run import)." : <>Try <Link href="/pipeline" className="underline">resetting the filters</Link>.</>}
        </Empty>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <caption className="sr-only">Tracked investors with status, score, latest signal and recommended action</caption>
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Investor</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Score</th>
                <th scope="col" className="px-3 py-2 font-medium">Latest relevant signal</th>
                <th scope="col" className="px-3 py-2 font-medium">Action</th>
                <th scope="col" className="px-3 py-2 font-medium">Relationship</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const st = STATE_META[r.state];
                return (
                  <tr key={r.id} className="align-top hover:bg-neutral-soft/50">
                    <th scope="row" className="px-4 py-3 font-medium">
                      <Link href={`/investors/${r.id}`} className="hover:underline">{r.firm_name}</Link>
                      <div className="mt-0.5 text-xs font-normal text-muted"><Link href={`/pipeline?entity=${r.entity_type}`} className="hover:text-ink hover:underline">{ENTITY_LABEL[r.entity_type]}</Link>{r.role_title ? ` · ${r.role_title}` : ""}</div>
                      <div className="mt-1 font-normal"><Fresh at={r.last_checked} /></div>
                    </th>
                    <td className="px-3 py-3"><Pill tone={st.tone} title={st.help} href={`/pipeline?state=${displayStatus(r.state)}`}>{st.label}</Pill></td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.follow_up_score ?? <span className="text-muted">–</span>}</td>
                    <td className="max-w-xs px-3 py-3">
                      {r.lead ? (
                        <>
                          <div className="line-clamp-2">{r.lead.headline}</div>
                          <div className="mt-0.5 text-xs text-muted"><Link href={`/signals?category=${r.lead.signal_type ?? "other"}`} className="hover:text-ink hover:underline">{TYPE_LABEL[r.lead.signal_type ?? "other"]}</Link> · {fmtDate(r.lead.published_at)}</div>
                        </>
                      ) : (
                        <span className="text-muted">{r.last_signal_date ? `Last: ${fmtDate(r.last_signal_date)}` : "None in window"}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">{r.recommended_action ? <Pill tone={ACTION_TONE[r.recommended_action]} href={`/pipeline?action=${r.recommended_action}`}>{ACTION_LABEL[r.recommended_action]}</Pill> : <span className="text-muted">–</span>}</td>
                    <td className="px-3 py-3 text-muted"><Link href={`/pipeline?relationship=${r.relationship_status}`} className="hover:text-ink hover:underline">{REL_LABEL[r.relationship_status]}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
