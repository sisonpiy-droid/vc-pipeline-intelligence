import Link from "next/link";
import { isDemoView } from "@/lib/demoData/mode";
import type { CSSProperties } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "@phosphor-icons/react/dist/ssr";
import { Fresh } from "@/components/Fresh";
import { PrintButton } from "@/components/PrintButton";
import { Empty, Eyebrow, ExternalLink, Pill, SetupError } from "@/components/ui";
import { getBrief, type Mover } from "@/lib/brief";
import { ACTION_LABEL, ACTION_TONE, TYPE_LABEL, ago, fmtDate, fmtDateTime, hostOf } from "@/lib/format";
import { load, today } from "@/lib/page";
import type { PipelineRow } from "@/lib/read";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly brief" };

const idx = (n: number) => ({ "--i": n }) as CSSProperties;

function Section({ id, title, count, children, i = 0 }: { id: string; title: string; count?: number; children: React.ReactNode; i?: number }) {
  return (
    <section aria-labelledby={id} className="reveal" style={idx(i)}>
      <div className="mb-3 flex items-baseline justify-between border-b border-line pb-2">
        <h2 id={id} className="text-base font-semibold tracking-tight">{title}</h2>
        {count !== undefined && <span className="num text-xs text-muted">{count}</span>}
      </div>
      {children}
    </section>
  );
}

function MoverRow({ m }: { m: Mover }) {
  const up = (m.delta ?? 0) > 0;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm">
      <Link href={`/investors/${m.id}`} className="font-medium hover:underline">{m.firm_name}</Link>
      <span className="flex items-center gap-2">
        {m.is_new ? (
          <Pill tone="info" title="First scored this run">new entrant</Pill>
        ) : (
          <span className={`num inline-flex items-center gap-0.5 font-medium ${up ? "text-good" : "text-bad"}`}>
            {up ? <ArrowUp aria-hidden size={12} weight="bold" /> : <ArrowDown aria-hidden size={12} weight="bold" />}
            {up ? "+" : ""}{m.delta}
            <span className="sr-only"> points</span>
          </span>
        )}
        <span className="num text-xs text-muted">{m.prev_score !== null ? `${m.prev_score} → ` : ""}{m.score}</span>
        {m.action && m.prev_action && m.action !== m.prev_action && (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            {ACTION_LABEL[m.prev_action]} <ArrowRight aria-hidden size={10} weight="bold" /> <span className="font-medium text-ink">{ACTION_LABEL[m.action]}</span>
          </span>
        )}
      </span>
    </li>
  );
}

function PersonRow({ r }: { r: PipelineRow }) {
  return (
    <li className="py-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <Link href={`/investors/${r.id}`} className="font-medium hover:underline">{r.firm_name}</Link>
        <span className="num text-lg font-medium">{r.follow_up_score ?? "–"}</span>
      </div>
      {r.lead && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{r.lead.headline}</p>}
      {r.angle && <p className="mt-1.5 border-l-2 border-accent pl-2.5 text-xs leading-relaxed"><span className="font-medium text-good">Angle: </span>{r.angle}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {r.recommended_action && <Pill tone={ACTION_TONE[r.recommended_action]}>{ACTION_LABEL[r.recommended_action]}</Pill>}
        <Fresh at={r.last_checked} />
      </div>
    </li>
  );
}

export default async function Brief() {
  const demo = await isDemoView();
  const res = await load((db) => getBrief(db, today(), demo));
  if (!res.ok) return <SetupError message={res.error} />;
  const b = res.data;

  if (!b.run)
    return (
      <Empty title="No completed refresh to report on yet">
        The brief summarises what changed in the latest refresh compared with the one before it. Run a refresh from the <Link href="/" className="underline underline-offset-2">priority queue</Link>.
      </Empty>
    );

  return (
    <>
      <header className="reveal mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Weekly brief</Eyebrow>
          <h1 className="mt-3 max-w-[24ch] text-3xl font-semibold leading-[1.1] tracking-tight md:text-[2.4rem]">What changed since the last refresh</h1>
          <p className="num mt-3 max-w-[70ch] text-xs leading-relaxed text-muted">
            Run {fmtDateTime(b.run.completed_at)} ({b.run.trigger_type}, {ago(b.run.completed_at)}) · {b.run.investors_total} investors searched
            {b.run.skipped ? ` · ${b.run.skipped} skipped to save search credits (checked recently or quiet)` : ""} · {b.run.search_calls} searches
            {b.previous ? ` · compared with ${fmtDateTime(b.previous.completed_at)}` : " · first run, so there is nothing to compare with yet"}
          </p>
        </div>
        <PrintButton />
      </header>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-12">
          <Section id="contact-h" title="Contact now" count={b.contact.length} i={1}>
            {b.contact.length === 0 ? (
              <p className="text-sm text-muted">Nobody clears the bar for an immediate approach this week. That is a result, not an error.</p>
            ) : (
              <ul className="divide-y divide-line">{b.contact.map((r) => <PersonRow key={r.id} r={r} />)}</ul>
            )}
          </Section>

          {b.followUps.length > 0 && (
            <Section id="fu-h" title="Follow-ups due" count={b.followUps.length} i={2}>
              <p className="mb-2 text-xs leading-relaxed text-muted">Investors you already contacted, past the point where silence is normal. Based on the last-contact date you entered.</p>
              <ul className="divide-y divide-line">
                {b.followUps.map(({ row, cadence: c }) => (
                  <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm">
                    <Link href={`/investors/${row.id}`} className="font-medium hover:underline">{row.firm_name}</Link>
                    <Pill tone={c.tone} title={`${row.relationship_status.replace(/_/g, " ")}, last contact ${fmtDate(row.last_contact_date)}`}>{c.label}</Pill>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section id="new-h" title="New signals this run" count={b.newSignals.length} i={2}>
            {b.newSignals.length === 0 ? (
              <p className="text-sm text-muted">This run found no new verified, relevant signal. Earlier signals are still on each investor's page until they leave the 30-day window.</p>
            ) : (
              <ul className="divide-y divide-line">
                {b.newSignals.map((s) => (
                  <li key={s.url} className="py-3.5 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <Link href={`/investors/${s.investor_id}`} className="font-medium hover:underline">{s.firm_name}</Link>
                      {s.new_capital && (
                        <Pill tone="good" title="The investor announced a new fund, a close, or a larger cheque ceiling: capital is available to deploy">
                          New fund capital
                        </Pill>
                      )}
                      <span className="num text-xs text-muted">{fmtDate(s.published_at)}</span>
                    </div>
                    <p className="mt-1 leading-snug"><ExternalLink href={s.url}>{s.headline}</ExternalLink></p>
                    <p className="mt-1 text-xs text-muted">{TYPE_LABEL[s.signal_type ?? "other"]} · {hostOf(s.url)} · relevance <span className="num">{s.relevance_score}</span></p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <aside className="space-y-12">
          <Section id="move-h" title="Score movers" count={b.movers.length} i={3}>
            {b.movers.length === 0 ? (
              <p className="text-sm text-muted">No investor moved by 5 points or more, or changed action.</p>
            ) : (
              <ul className="divide-y divide-line">{b.movers.slice(0, 10).map((m) => <MoverRow key={m.id} m={m} />)}</ul>
            )}
          </Section>

          <Section id="prep-h" title="Prepare a targeted message" count={b.prepare.length} i={4}>
            {b.prepare.length === 0 ? <p className="text-sm text-muted">None this week.</p> : <ul className="divide-y divide-line">{b.prepare.slice(0, 6).map((r) => <PersonRow key={r.id} r={r} />)}</ul>}
          </Section>

          <Section id="hold-h" title="Don't chase" count={b.hold.length} i={5}>
            {b.hold.length === 0 ? <p className="text-sm text-muted">Nobody on hold.</p> : <ul className="divide-y divide-line">{b.hold.map((r) => <PersonRow key={r.id} r={r} />)}</ul>}
          </Section>

          <Section id="att-h" title="Needs attention" count={b.attention.length} i={6}>
            {b.attention.length === 0 ? (
              <p className="text-sm text-muted">Every investor searched this run was checked completely.</p>
            ) : (
              <>
                <p className="mb-2 text-xs leading-relaxed text-muted">Activity unknown for these, which is different from quiet.</p>
                <ul className="divide-y divide-line">
                  {b.attention.slice(0, 8).map((r) => (
                    <li key={r.id} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                      <Link href={`/investors/${r.id}`} className="font-medium hover:underline">{r.firm_name}</Link>
                      <Pill tone={r.state === "failed" ? "bad" : "warn"}>{r.state === "failed" ? "failed" : r.state === "not_checked" ? "not checked" : "partial"}</Pill>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}
