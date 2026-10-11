import Link from "next/link";
import { isDemoView } from "@/lib/demoData/mode";
import type { ReactNode } from "react";
import { Empty, ExternalLink, PageTitle, Pill, ScoreBadge, SetupError } from "@/components/ui";
import { cadence } from "@/lib/cadence";
import { getCompare, parseIds, type CompareItem } from "@/lib/compare";
import { ACTION_LABEL, ACTION_TONE, ENTITY_LABEL, REL_LABEL, SECTOR_LABEL, STATE_META, TIER_LABEL, fmtDate, hostOf } from "@/lib/format";
import { first, load, today } from "@/lib/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare investors" };

const FACTORS = ["recency", "relevance", "evidence", "fit", "relationship"] as const;

/** One labelled row; the best value in the row (when it has a numeric meaning) is marked, with text as well as colour. */
function Row({ label, hint, cells }: { label: string; hint?: string; cells: ReactNode[] }) {
  return (
    <div role="row" className="grid items-start gap-4 border-t border-line py-4" style={{ gridTemplateColumns: `8.5rem repeat(${cells.length}, minmax(0, 1fr))` }}>
      <div role="rowheader" className="pr-2">
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-muted">{label}</p>
        {hint && <p className="mt-1 text-[0.65rem] leading-snug text-muted">{hint}</p>}
      </div>
      {cells.map((c, i) => <div key={i} role="cell" className="min-w-0 text-sm leading-relaxed">{c}</div>)}
    </div>
  );
}

const Best = ({ on, children }: { on: boolean; children: ReactNode }) => (
  <span className={on ? "font-semibold text-good" : ""}>{children}{on && <span className="ml-1.5 rounded-full bg-good-soft px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-good">best</span>}</span>
);

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ids = parseIds(first(sp.ids));
  const demo = await isDemoView();
  const res = await load((db) => getCompare(db, ids, today(), demo ? true : "all"));
  if (!res.ok) return <SetupError message={res.error} />;
  const items = res.data;
  const t = today();

  if (items.length < 2)
    return (
      <>
        <PageTitle title="Compare investors" sub="Put two or three investors side by side: score, factors, evidence, profile and relationship." />
        <Empty title={ids.length === 0 ? "Nothing selected yet" : "Pick at least two investors"}>
          Use the <strong>Compare</strong> button on an investor, in the pipeline, or press <kbd className="num rounded border border-line px-1 text-xs">Ctrl</kbd> <kbd className="num rounded border border-line px-1 text-xs">K</kbd> to search. A tray appears at the bottom with a link here.
        </Empty>
      </>
    );

  const best = (pick: (i: CompareItem) => number | null, higher = true) => {
    const vals = items.map(pick);
    const target = vals.filter((v): v is number => v !== null).reduce<number | null>((a, v) => (a === null ? v : higher ? Math.max(a, v) : Math.min(a, v)), null);
    return vals.map((v) => v !== null && v === target && vals.filter((x) => x === target).length === 1);
  };
  const scoreBest = best((i) => i.row.follow_up_score);

  return (
    <>
      <PageTitle title="Compare investors" sub="The best value in each numeric row is marked. Nothing here changes a score." />
      <div role="table" aria-label="Investor comparison" className="overflow-x-auto">
        <div className="min-w-[44rem]">
          <div role="row" className="grid gap-4 pb-4" style={{ gridTemplateColumns: `8.5rem repeat(${items.length}, minmax(0, 1fr))` }}>
            <div />
            {items.map((i) => (
              <div key={i.row.id} role="columnheader" className="min-w-0">
                <Link href={`/investors/${i.row.id}`} className="text-lg font-semibold leading-tight tracking-tight hover:underline">{i.row.firm_name}</Link>
                <p className="mt-0.5 text-xs text-muted">{ENTITY_LABEL[i.row.entity_type]}{i.entity_note ? ` · ${i.entity_note}` : ""}</p>
              </div>
            ))}
          </div>

          <Row label="Score" hint="0–100, fixed rules" cells={items.map((i, n) => <div key={n} className="flex items-center gap-3"><ScoreBadge score={i.row.follow_up_score} /><Best on={scoreBest[n]!}> </Best></div>)} />
          <Row label="Action" cells={items.map((i) => (i.row.recommended_action ? <Pill tone={ACTION_TONE[i.row.recommended_action]}>{ACTION_LABEL[i.row.recommended_action]}</Pill> : "—"))} />
          <Row label="Held back by" hint="why not 'reach out now'" cells={items.map((i) => (i.row.capped_by.length ? <ul className="list-disc space-y-1 pl-4 text-xs text-warn">{i.row.capped_by.map((c) => <li key={c}>{c}</li>)}</ul> : <span className="text-muted">nothing</span>))} />

          {FACTORS.map((f) => {
            const b = best((i) => i.row.breakdown?.[f]?.points ?? null);
            return (
              <Row key={f} label={f} hint={f === "recency" ? "how fresh the lead signal is" : f === "relevance" ? "to logistics SaaS at Seed" : f === "evidence" ? "confidence and source quality" : f === "fit" ? "stage, sector, geography" : "your relationship"}
                cells={items.map((i, n) => {
                  const c = i.row.breakdown?.[f];
                  return c ? (
                    <div key={n}>
                      <Best on={b[n]!}><span className="num">{c.points} / {c.max}</span></Best>
                      <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-neutral-soft"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((c.points / c.max) * 100)}%` }} /></div>
                      <p className="mt-1.5 text-xs text-muted">{c.note}</p>
                    </div>
                  ) : <span className="text-muted">—</span>;
                })}
              />
            );
          })}

          <Row label="Lead signal" cells={items.map((i) => {
            const l = i.row.lead;
            if (!l) return <span className="text-muted">{STATE_META[i.row.state].label}: {i.row.signal_summary ?? "no signal"}</span>;
            return (
              <div>
                <p className="font-medium leading-snug">{l.headline}</p>
                <p className="num mt-1 text-xs text-muted">{fmtDate(l.published_at)} · <ExternalLink href={l.url}>{hostOf(l.url)}</ExternalLink></p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {l.sector_match && <Pill tone={SECTOR_LABEL[l.sector_match]!.tone} title={SECTOR_LABEL[l.sector_match]!.help}>{SECTOR_LABEL[l.sector_match]!.label}</Pill>}
                  <Pill tone={TIER_LABEL[l.tier]!.tone} title={TIER_LABEL[l.tier]!.help}>{TIER_LABEL[l.tier]!.label}</Pill>
                  {l.new_capital && <Pill tone="good">New capital</Pill>}
                </div>
              </div>
            );
          })} />
          <Row label="Score trend" hint="last scorings, oldest first" cells={items.map((i) => <span className="num">{i.recent_scores.length ? i.recent_scores.join(" → ") : "—"}</span>)} />
          <Row label="Profile" cells={items.map((i) => (
            <dl className="space-y-1 text-xs">
              <div><dt className="inline text-muted">Stage: </dt><dd className="inline">{i.stage ?? "unknown"}</dd></div>
              <div><dt className="inline text-muted">Sectors: </dt><dd className="inline">{i.sectors.length ? i.sectors.join(", ") : "none recorded"}</dd></div>
              <div><dt className="inline text-muted">Geography: </dt><dd className="inline">{i.geography ?? "unknown"}</dd></div>
              <div><dt className="inline text-muted">Thesis: </dt><dd className="inline">{i.thesis_verified ? "verified" : "not verified"}</dd></div>
            </dl>
          ))} />
          <Row label="Relationship" hint="your data" cells={items.map((i) => {
            const c = cadence(i.row.relationship_status, i.row.last_contact_date, t);
            return <div className="space-y-1.5"><Pill tone="info">{REL_LABEL[i.row.relationship_status]}</Pill>{c && <p><Pill tone={c.tone}>{c.label}</Pill></p>}</div>;
          })} />
          <Row label="Status" cells={items.map((i) => <Pill tone={STATE_META[i.row.state].tone} title={STATE_META[i.row.state].help}>{STATE_META[i.row.state].label}</Pill>)} />
        </div>
      </div>
    </>
  );
}
