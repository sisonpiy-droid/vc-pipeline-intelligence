import Link from "next/link";
import { isDemoView } from "@/lib/demoData/mode";
import type { CSSProperties } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, CaretDown } from "@phosphor-icons/react/dist/ssr";
import { Fresh } from "@/components/Fresh";
import { PrintButton } from "@/components/PrintButton";
import { Empty, PageTitle, Pill, SetupError, Stat } from "@/components/ui";
import { getBrief, type Mover } from "@/lib/brief";
import { ACTION_LABEL, ACTION_TONE, TYPE_LABEL, ago, fmtDate, fmtDateTime, hostOf, safeHref } from "@/lib/format";
import { load, today } from "@/lib/page";
import type { PipelineRow } from "@/lib/read";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly brief" };

const idx = (n: number) => ({ "--i": n }) as CSSProperties;

function Section({ id, title, count, children, i = 0 }: { id: string; title: string; count?: number; children: React.ReactNode; i?: number }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="reveal scroll-mt-24" style={idx(i)}>
      <div className="mb-3 flex items-center gap-2.5">
        <h2 id={`${id}-t`} className="text-sm font-semibold tracking-tight">{title}</h2>
        {count !== undefined && <span className="num rounded-full bg-neutral-soft px-2 py-0.5 text-[0.7rem] text-muted">{count}</span>}
      </div>
      {children}
    </section>
  );
}

/** A row that is one line when closed and shows its detail when opened. */
function Fold({ lead, title, sub, right, children }: { lead?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="group border-b border-line last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
        {lead}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          {sub && <span className="mt-0.5 block truncate text-xs text-muted">{sub}</span>}
        </span>
        {right}
        <CaretDown aria-hidden size={13} weight="bold" className="shrink-0 text-muted transition-transform duration-300 group-open:rotate-180" />
      </summary>
      <div className="space-y-3 pb-4 pl-0 pr-6 text-sm sm:pl-[3.25rem]">{children}</div>
    </details>
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
    <li>
      <Fold
        lead={<span className="num w-9 shrink-0 text-center text-lg font-medium">{r.follow_up_score ?? "–"}</span>}
        title={r.firm_name}
        sub={r.lead?.headline}
        right={r.recommended_action ? <span className="hidden sm:block"><Pill tone={ACTION_TONE[r.recommended_action]}>{ACTION_LABEL[r.recommended_action]}</Pill></span> : null}
      >
        {r.lead && <p className="max-w-[65ch] leading-relaxed">{r.lead.headline}</p>}
        {r.angle && <p className="max-w-[65ch] border-l-2 border-accent pl-3 leading-relaxed text-ink/85"><span className="font-medium text-good">Opening line: </span>{r.angle}</p>}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
          {r.recommended_action && <span className="sm:hidden"><Pill tone={ACTION_TONE[r.recommended_action]}>{ACTION_LABEL[r.recommended_action]}</Pill></span>}
          <Fresh at={r.last_checked} />
          <Link href={`/investors/${r.id}`} className="font-medium text-accent hover:underline">Open the evidence</Link>
        </p>
      </Fold>
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
      <PageTitle
        eyebrow="Weekly brief"
        title="What changed since the last refresh"
        sub={<>Run of {fmtDateTime(b.run.completed_at)} ({b.run.trigger_type}, {ago(b.run.completed_at)}): {b.run.investors_total} investors searched with {b.run.search_calls} searches{b.run.skipped ? `, ${b.run.skipped} skipped to save credits` : ""}. {b.previous ? `Compared with ${fmtDateTime(b.previous.completed_at)}.` : "First run, so there is nothing to compare with yet."}</>}
      >
        <PrintButton />
      </PageTitle>

      <div className="mb-12 grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
        <Stat label="Contact now" value={b.contact.length} href="#contact-h" tone={b.contact.length ? "good" : undefined} />
        <Stat label="Follow-ups due" value={b.followUps.length} href={b.followUps.length ? "#fu-h" : undefined} />
        <Stat label="New signals" value={b.newSignals.length} href="#new-h" />
        <Stat label="Needs attention" value={b.attention.length} href="#att-h" tone={b.attention.length ? "warn" : undefined} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-12">
          <Section id="contact-h" title="Contact now" count={b.contact.length} i={1}>
            {b.contact.length === 0 ? (
              <p className="text-sm text-muted">Nobody clears the bar for an immediate approach this week. That is a result, not an error.</p>
            ) : (
              <ul>{b.contact.map((r) => <PersonRow key={r.id} r={r} />)}</ul>
            )}
          </Section>

          {b.followUps.length > 0 && (
            <Section id="fu-h" title="Follow-ups due" count={b.followUps.length} i={2}>
              <p className="mb-2 text-xs leading-relaxed text-muted">Investors you already contacted, past the point where silence is normal. Based on the last-contact date you entered.</p>
              <ul>
                {b.followUps.map(({ row, cadence: c }) => (
                  <li key={row.id}>
                    <Fold title={row.firm_name} sub={`${row.relationship_status.replace(/_/g, " ")}, last contact ${fmtDate(row.last_contact_date)}`} right={<Pill tone={c.tone}>{c.label}</Pill>}>
                      <Link href={`/investors/${row.id}`} className="text-xs font-medium text-accent hover:underline">Open the investor</Link>
                    </Fold>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section id="new-h" title="New signals this run" count={b.newSignals.length} i={2}>
            {b.newSignals.length === 0 ? (
              <p className="text-sm text-muted">This run found no new verified, relevant signal. Earlier signals are still on each investor's page until they leave the 30-day window.</p>
            ) : (
              <ul>
                {b.newSignals.map((x) => (
                  <li key={x.url}>
                    <Fold
                      lead={<span className="num w-9 shrink-0 text-center text-lg font-medium text-muted">{x.relevance_score}</span>}
                      title={x.headline}
                      sub={`${x.firm_name} · ${fmtDate(x.published_at)}`}
                      right={x.new_capital ? <span className="hidden sm:block"><Pill tone="good" title="The investor announced a new fund, a close, or a larger cheque ceiling">New fund capital</Pill></span> : null}
                    >
                      <p className="text-xs text-muted">{TYPE_LABEL[x.signal_type ?? "other"]} · {hostOf(x.url)} · relevance <span className="num">{x.relevance_score}</span></p>
                      <p className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                        {safeHref(x.url) && <a href={safeHref(x.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">Open the source <ArrowUpRight aria-hidden size={12} weight="bold" /><span className="sr-only"> (opens in a new tab)</span></a>}
                        <Link href={`/investors/${x.investor_id}`} className="font-medium text-accent hover:underline">Open {x.firm_name}</Link>
                      </p>
                    </Fold>
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
            {b.prepare.length === 0 ? <p className="text-sm text-muted">None this week.</p> : <ul>{b.prepare.slice(0, 6).map((r) => <PersonRow key={r.id} r={r} />)}</ul>}
          </Section>

          <Section id="hold-h" title="Don't chase" count={b.hold.length} i={5}>
            {b.hold.length === 0 ? <p className="text-sm text-muted">Nobody on hold.</p> : <ul>{b.hold.map((r) => <PersonRow key={r.id} r={r} />)}</ul>}
          </Section>

          <Section id="att-h" title="Needs attention" count={b.attention.length} i={6}>
            {b.attention.length === 0 ? (
              <p className="text-sm text-muted">Every investor searched this run was checked completely.</p>
            ) : (
              <>
                <p className="mb-2 text-xs leading-relaxed text-muted">We couldn't check these yet, which is different from quiet.</p>
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
