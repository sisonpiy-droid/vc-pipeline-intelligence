import Link from "next/link";
import { isDemoView } from "@/lib/demoData/mode";
import { ClickableRow } from "@/components/ClickableRow";
import { CompareToggle } from "@/components/CompareToggle";
import { Fresh } from "@/components/Fresh";
import { LiveSearch } from "@/components/LiveSearch";
import { Card, Empty, PageTitle, Pill, SetupError } from "@/components/ui";
import { ACTION_LABEL, ACTION_TONE, ENTITY_LABEL, REL_LABEL, STATE_META, TYPE_LABEL, fmtDate } from "@/lib/format";
import { load, pick, today } from "@/lib/page";
import { PRIORITY, displayStatus, filterPipeline, listPipeline, sectorOptions } from "@/lib/read";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pipeline" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const SELECT = "w-full rounded-lg border border-line bg-bg px-2.5 py-2 text-sm transition-colors hover:border-accent/40";
const VIEWS = [{ key: "", label: "All" }, { key: "active", label: "Active signal" }, { key: "quiet", label: "Quiet" }, { key: "review", label: "Needs review" }, { key: "failed", label: "Failed" }] as const;

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
  const demo = await isDemoView();
  const res = await load((db) => listPipeline(db, today(), demo ? true : "all"));
  if (!res.ok) return <SetupError message={res.error} />;
  const all = res.data;
  const rows = filterPipeline(all, f, today());
  const filtered = Object.entries(f).some(([k, v]) => v && k !== "sort");

  return (
    <>
      <PageTitle title="Investor pipeline" sub={`${rows.length} of ${all.length} tracked investors. Statuses separate a quiet investor (searched, nothing found) from one we could not check.`} />

      <nav aria-label="Quick views" className="mb-4 flex flex-wrap gap-1.5">
        {VIEWS.map((v) => {
          const n = v.key ? all.filter((r) => displayStatus(r.state) === v.key).length : all.length;
          const on = (f.state ?? "") === v.key;
          return (
            <Link key={v.label} href={v.key ? `/pipeline?state=${v.key}` : "/pipeline"} aria-current={on ? "true" : undefined}
              className={`press inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${on ? "border-accent bg-accent/10 font-medium text-ink" : "border-line text-muted hover:border-accent/40 hover:text-ink"}`}>
              {v.label}<span className="num text-xs text-muted">{n}</span>
            </Link>
          );
        })}
      </nav>

      <form method="get" className="mb-5 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1"><LiveSearch initial={f.q ?? ""} /></div>
          <div className="w-48"><Field label="Sort by" name="sort" value={f.sort}>
            <option value="">Follow-up score</option>
            <option value="recent">Latest signal date</option>
            <option value="name">Name</option>
          </Field></div>
          <button className="press rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white dark:text-black">Apply</button>
          {filtered && <Link href="/pipeline" className="press rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-ink">Reset</Link>}
        </div>
        <details className="group mt-3" open={Boolean(f.entity || f.sector || f.stage || f.relationship || f.category || f.freshness || f.priority || f.action)}>
          <summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-accent">More filters</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
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
          </div>
        </details>
      </form>

      {rows.length === 0 ? (
        <Empty title="No investors match these filters">
          {all.length === 0 ? "No investors have been imported yet (npm run import)." : <>Try <Link href="/pipeline" className="underline">resetting the filters</Link>.</>}
        </Empty>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <caption className="sr-only">Tracked investors with status, score, latest signal and recommended action</caption>
            <thead className="border-b border-line bg-neutral-soft/40 text-[0.7rem] uppercase tracking-[0.1em] text-muted">
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
                  <ClickableRow as="tr" key={r.id} href={`/investors/${r.id}`} className="align-top hover:bg-neutral-soft/50">
                    <th scope="row" className="px-4 py-3 font-medium">
                      <Link href={`/investors/${r.id}`} className="hover:underline">{r.firm_name}</Link>{r.is_demo && <span className="ml-2 align-middle"><Pill tone="warn" title="Synthetic demo account: not a real investor">Demo account</Pill></span>}
                      <div className="mt-0.5 text-xs font-normal text-muted"><Link href={`/pipeline?entity=${r.entity_type}`} className="hover:text-ink hover:underline">{ENTITY_LABEL[r.entity_type]}</Link>{r.role_title ? ` · ${r.role_title}` : ""}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 font-normal"><Fresh at={r.last_checked} /><CompareToggle id={r.id} name={r.firm_name} compact /></div>
                    </th>
                    <td className="px-3 py-3"><Pill tone={st.tone} title={st.help} href={`/pipeline?state=${displayStatus(r.state)}`}>{st.label}</Pill></td>
                    <td className="px-3 py-3 text-right">{r.follow_up_score === null ? <span className="text-muted">–</span> : <span className="ml-auto block w-14"><span className="num block text-base font-medium leading-none">{r.follow_up_score}</span><span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-neutral-soft"><span style={{ width: `${r.follow_up_score}%` }} className={`block h-full rounded-full ${r.follow_up_score >= 75 ? "bg-good" : r.follow_up_score >= 55 ? "bg-info" : "bg-muted/60"}`} /></span></span>}</td>
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
                  </ClickableRow>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
