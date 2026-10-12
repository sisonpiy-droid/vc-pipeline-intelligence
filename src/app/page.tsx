import Link from "next/link";
import { isDemoView } from "@/lib/demoData/mode";
import type { CSSProperties } from "react";
import { InvestorCard } from "@/components/InvestorCard";
import { TopPicks } from "@/components/TopPicks";
import { RefreshButton } from "@/components/RefreshButton";
import { CountUp } from "@/components/motion/CountUp";
import { HeroReveal } from "@/components/motion/HeroReveal";
import { Magnetic } from "@/components/motion/Magnetic";
import { StoryCards, type Story } from "@/components/StoryCards";
import { Empty, Eyebrow, Pill, SetupError } from "@/components/ui";
import { cadence } from "@/lib/cadence";
import { ACTION_LABEL, REL_LABEL, ago, fmtDateTime, greeting } from "@/lib/format";
import { isOpenDemo } from "@/lib/demo";
import { load, today } from "@/lib/page";
import { topPicks } from "@/lib/picks";
import { getOverview, type PipelineRow } from "@/lib/read";
import { ACTION_THRESHOLDS, STARTUP, WEIGHTS } from "@/lib/scoring/score";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Priority queue · VC Pipeline Intelligence" } };

const HOLD = (r: PipelineRow) => r.recommended_action === "wait_for_response" || r.relationship_status === "passed" || r.relationship_status === "committed";
const idx = (n: number) => ({ "--i": n }) as CSSProperties;

/** The whole list at a glance: one bar, split by what is known about each investor. */
function Mix({ total, parts }: { total: number; parts: { label: string; n: number; cls: string }[] }) {
  if (total === 0) return null;
  const label = parts.filter((p) => p.n > 0).map((p) => `${p.n} ${p.label.toLowerCase()}`).join(", ");
  return (
    <div>
      <div role="img" aria-label={`Of ${total} investors: ${label}`} className="flex h-2.5 gap-[3px] overflow-hidden rounded-full">
        {parts.filter((p) => p.n > 0).map((p, i) => (
          <span key={p.label} style={{ width: `${(p.n / total) * 100}%`, ["--i" as string]: i }} className={`bar-fill block h-full min-w-[6px] rounded-full ${p.cls}`} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem] text-muted">
        {parts.filter((p) => p.n > 0).map((p) => (
          <li key={p.label} className="flex items-center gap-1.5"><span aria-hidden className={`h-2 w-2 rounded-full ${p.cls}`} />{p.label}</li>
        ))}
      </ul>
    </div>
  );
}

const longDate = (now = new Date()) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(now);

function LedgerRow({ label, hint, value, href, tone }: { label: string; hint: string; value: number; href: string; tone?: string }) {
  return (
    <Link href={href} className="group flex items-baseline justify-between gap-4 py-3.5 transition-colors hover:bg-neutral-soft/60">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <span className={`num text-3xl font-medium transition-transform duration-300 group-hover:-translate-x-0.5 ${tone ?? ""}`}><CountUp value={value} /></span>
    </Link>
  );
}

export default async function Overview() {
  const demo = await isDemoView();
  const res = await load((db) => getOverview(db, today(), demo ? true : "all"));
  if (!res.ok) return <SetupError message={res.error} />;
  const { pipeline: everyone, counts, active, lastGood, runs, demoCount } = res.data;
  // Synthetic demo accounts are listed in their own labelled section below. They never enter the real shortlist, queue or counts.
  const pipeline = demo ? everyone : everyone.filter((r) => !r.is_demo);
  const demoRows = demo ? [] : everyone.filter((r) => r.is_demo);

  const hold = pipeline.filter((r) => r.state === "active" && HOLD(r));
  const queue = pipeline
    .filter((r) => r.state === "active" && !HOLD(r) && r.recommended_action !== "no_action")
    .sort((a, b) => (b.follow_up_score ?? 0) - (a.follow_up_score ?? 0) || (b.last_signal_date ?? "").localeCompare(a.last_signal_date ?? ""));
  const picks = topPicks(pipeline);
  const picked = new Set(picks.map((p) => p.row.id));
  const rest = queue.filter((r) => !picked.has(r.id));
  const never = runs.length === 0;
  const unknown = counts.failed + counts.review;
  const { reachOutNow, prepareOutreach } = ACTION_THRESHOLDS;

  const due = pipeline.filter((r) => cadence(r.relationship_status, r.last_contact_date, today())?.due);
  const newCapital = pipeline.filter((r) => r.state === "active" && r.lead?.new_capital && !HOLD(r));
  const logistics = pipeline.filter((r) => r.state === "active" && r.lead?.sector_match === "logistics");
  const fresh = pipeline.filter((r) => r.relationship_status === "not_contacted").length;
  const official = pipeline.filter((r) => r.state === "active" && r.lead?.tier === "official");
  const stories: Story[] = [
    picks.length > 0 && { key: "top", kicker: "Email first", big: String(picks.length), title: `${picks.length === 1 ? "investor is" : "investors are"} worth an email this week`, sub: picks.slice(0, 3).map((p) => p.row.firm_name).join(", "), href: "#picks-h" },
    newCapital.length > 0 && { key: "capital", kicker: "New fund capital", big: String(newCapital.length), title: `${newCapital.length === 1 ? "Investor has" : "Investors have"} announced new capital`, sub: newCapital.slice(0, 2).map((r) => r.firm_name).join(", "), href: "/signals" },
    due.length > 0 && { key: "due", kicker: "Follow-ups due", big: String(due.length), title: `${due.length === 1 ? "Reply is" : "Replies are"} overdue`, sub: due.slice(0, 2).map((r) => r.firm_name).join(", "), href: "/brief#fu-h" },
    hold.length > 0 && { key: "hold", kicker: "Don't chase", big: String(hold.length), title: "Waiting on a reply, or they passed", sub: hold.slice(0, 2).map((r) => r.firm_name).join(", "), href: "/pipeline?relationship=awaiting_response" },
    unknown > 0 && { key: "unknown", kicker: "Second look", big: String(unknown), title: `${unknown === 1 ? "Search" : "Searches"} failed or came back partial`, sub: "We couldn't check them yet, which is not the same as quiet.", href: "/quiet" },
    { key: "logistics", kicker: "Logistics fit", big: String(logistics.length), title: `${logistics.length === 1 ? "investor has" : "investors have"} a signal about logistics`, sub: logistics.slice(0, 2).map((r) => r.firm_name).join(", ") || "None this week.", href: "/signals" },
    official.length > 0 && { key: "official", kicker: "Official source", big: String(official.length), title: `${official.length === 1 ? "signal comes" : "signals come"} from the investor's own site`, sub: "The most trustworthy kind of evidence.", href: "/signals" },
    { key: "fresh", kicker: "Not contacted yet", big: String(fresh), title: `${fresh === 1 ? "investor is" : "investors are"} still waiting for a first email`, sub: "Your untouched list, ready when you are.", href: "/pipeline?relationship=not_contacted" },
    { key: "quiet", kicker: "Quiet", big: String(counts.quiet), title: "Searched, nothing relevant", sub: "Where not to spend energy this week.", href: "/quiet" },
  ].filter((x): x is Story => Boolean(x));

  return (
    <>
      {/* Greeting and the two things you do most */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <p className="text-sm font-medium text-accent">{longDate()}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">{greeting()}, Vikram</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {demo ? <span className="text-sm text-muted">Demo mode: use &ldquo;Run simulated refresh&rdquo; in the banner above.</span> : <Magnetic><RefreshButton needPass={!isOpenDemo()} /></Magnetic>}
          <Link href="/brief" className="press inline-flex items-center rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium transition-colors hover:border-accent/50">Weekly brief</Link>
        </div>
      </header>

      {/* Hero: the answer on the left, the arithmetic behind it as a ledger on the right */}
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
        <HeroReveal>
          <div data-hero className="js-hide"><Eyebrow>This week</Eyebrow></div>
          <h2 data-hero className="js-hide mt-3 max-w-[20ch] text-4xl font-semibold leading-[1.04] tracking-tight md:text-[3.1rem]">
            {never ? (
              "Nothing to rank until the first refresh runs"
            ) : counts.active === 0 ? (
              "No investor has a strong signal right now"
            ) : (
              <>
                <span className="num text-accent">{counts.active}</span> of {counts.total} investors have a fresh, relevant signal
              </>
            )}
          </h2>
          <p data-hero className="js-hide mt-4 max-w-[58ch] text-sm leading-relaxed text-muted">
            Ranked by a transparent follow-up score. Every recommendation links to the public evidence behind it, and investors with no verified signal are listed rather than hidden.
          </p>
          <div data-hero className="js-hide mt-6 flex flex-wrap items-center gap-3">
            <Link href="/signals" className="press rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-ink">Browse all signals</Link>
          </div>
        </HeroReveal>

        <div className="reveal" style={idx(1)}>
          <Mix total={counts.total} parts={[
            { label: "Active signal", n: counts.active, cls: "bg-accent" },
            { label: "Older signals only", n: Math.max(0, counts.total - counts.active - counts.quiet - unknown), cls: "bg-info/50" },
            { label: "No verified signal", n: counts.quiet, cls: "bg-neutral/35" },
            { label: "Couldn't check yet", n: unknown, cls: "bg-warn" },
          ]} />
        <dl className="mt-4 divide-y divide-line border-y border-line">
          <LedgerRow label="Tracked investors" hint={demo ? `${counts.total} synthetic demo accounts` : `50 VC firms and 32 angels${demoCount ? `; ${demoCount} labelled demo accounts are listed separately` : ""}`} value={counts.total} href="/pipeline" />
          <LedgerRow label="Active signal, last 30 days" hint="verified and relevant" value={counts.active} href="/pipeline?state=active" tone="text-good" />
          <LedgerRow label="No verified signal" hint="every source answered" value={counts.quiet} href="/quiet" />
          <LedgerRow label="Couldn't check yet" hint="a search failed, so we never call it quiet" value={unknown} href="/quiet" tone={unknown ? "text-warn" : ""} />
        </dl>
        </div>
      </section>

      {active && (
        <div className="reveal mt-8 rounded-2xl border border-line p-4 text-sm" style={idx(2)}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">Refresh in progress</span>
            <span className="num text-muted">{active.investors_processed} / {active.investors_total} investors</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-soft" role="progressbar" aria-valuemin={0} aria-valuemax={active.investors_total} aria-valuenow={active.investors_processed} aria-label="Refresh progress">
            <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.round((active.investors_processed / Math.max(1, active.investors_total)) * 100)}%` }} />
          </div>
        </div>
      )}

      {unknown > 0 && !never && (
        <div role="note" className="mt-8 rounded-2xl border border-warn/40 bg-warn-soft p-4 text-sm text-warn">
          <strong>{unknown} investor{unknown > 1 ? "s" : ""} could not be fully checked.</strong> Their activity is <em>unknown</em>, not absent.{" "}
          <Link href="/quiet" className="font-medium underline underline-offset-2">See which and why</Link>.
        </div>
      )}

      {!never && <StoryCards stories={stories} />}

      {!never && <TopPicks picks={picks} />}

      {/* Queue (wide) + rail (narrow, sticky) */}
      <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section aria-labelledby="queue-h">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 id="queue-h" className="text-lg font-semibold tracking-tight">{picks.length ? "Next in line" : "Priority queue"}</h2>
            {rest.length > 0 && <span className="num text-xs text-muted">{rest.length} more to act on</span>}
          </div>
          {never ? (
            <Empty title="No refresh has run yet" action={demo ? undefined : <RefreshButton label="Run the first refresh" needPass={!isOpenDemo()} />}>
              {counts.total} investors are imported. The first refresh searches public sources for activity in the last 30 days and scores each investor. Nothing is shown as a placeholder.
            </Empty>
          ) : rest.length === 0 && picks.length === 0 ? (
            <Empty title="Nobody has a strong, relevant signal right now">
              That is a result, not an error. See <Link href="/quiet" className="underline underline-offset-2">quiet investors</Link> for what was searched, or wait for the next scheduled refresh.
            </Empty>
          ) : (
            <div className="space-y-4">
              {rest.length === 0 && <p className="text-sm text-muted">Everyone with a relevant signal is already in the list above.</p>}
              {rest.map((r, i) => (
                <InvestorCard key={r.id} r={r} rank={picks.length + i + 1} />
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-10 lg:sticky lg:top-8 lg:self-start">
          {hold.length > 0 && (
            <section aria-labelledby="hold-h" className="reveal" style={idx(3)}>
              <Eyebrow>Don't chase this week</Eyebrow>
              <h2 id="hold-h" className="sr-only">Investors to hold off on</h2>
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {hold.map((r) => (
                  <li key={r.id} className="py-3 text-sm">
                    <Link href={`/investors/${r.id}`} className="font-medium hover:underline">{r.firm_name}</Link>
                    <div className="mt-1"><Pill tone="info">{REL_LABEL[r.relationship_status]}</Pill></div>
                    {r.lead && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{r.lead.headline}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="legend-h" className="reveal" style={idx(4)}>
            <Eyebrow>Reading the score</Eyebrow>
            <h2 id="legend-h" className="sr-only">How the score maps to an action</h2>
            <dl className="mt-3 divide-y divide-line border-y border-line text-sm">
              <div className="flex items-baseline justify-between py-2.5"><dt>{ACTION_LABEL.reach_out_now}</dt><dd className="num text-good">{reachOutNow}+</dd></div>
              <div className="flex items-baseline justify-between py-2.5"><dt>{ACTION_LABEL.prepare_targeted_outreach}</dt><dd className="num">{prepareOutreach}–{reachOutNow - 1}</dd></div>
              <div className="flex items-baseline justify-between py-2.5"><dt>{ACTION_LABEL.research_further}</dt><dd className="num text-muted">&lt;{prepareOutreach}</dd></div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Recency 30 · relevance 30 · evidence 20 · fit 15 · relationship 5. A fresh but off-topic article earns nothing, and a failed search never lowers a score.
            </p>
          </section>

          <section aria-labelledby="assume-h" className="reveal" style={idx(5)}>
            <Eyebrow>Scoring assumes</Eyebrow>
            <h2 id="assume-h" className="sr-only">Startup profile the scores assume</h2>
            <dl className="mt-3 divide-y divide-line border-y border-line text-sm">
              <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">Company</dt><dd className="text-right">{STARTUP.description}</dd></div>
              <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">Sector</dt><dd className="text-right">{STARTUP.sector}</dd></div>
              <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">Geography</dt><dd className="text-right">{STARTUP.geography} <span className="text-xs text-warn">(assumed)</span></dd></div>
              <div className="flex justify-between gap-4 py-2.5"><dt className="text-muted">Weights</dt><dd className="num text-right text-xs">{Object.entries(WEIGHTS).map(([k, v]) => `${k.slice(0, 3)} ${v}`).join(" · ")}</dd></div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              A <strong className="font-medium text-ink">policy score, not a probability</strong>. It ranks who to look at first from public evidence; it has not been calibrated against real fundraising outcomes.
            </p>
          </section>

          <p className="num text-[0.7rem] leading-relaxed text-muted">
            {lastGood ? `Data as of ${fmtDateTime(lastGood.completed_at)} · ${ago(lastGood.completed_at)}` : "No completed refresh yet"}
          </p>
        </aside>
      </div>
      {demoRows.length > 0 && (
        <section id="demo-accounts" aria-labelledby="demo-h" className="mt-16 border-t border-line pt-10">
          <Eyebrow>Demo accounts</Eyebrow>
          <h2 id="demo-h" className="mt-1 text-lg font-semibold tracking-tight">{demoRows.length} synthetic accounts for testing</h2>
          <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-muted">
            These are not real investors: one account for each situation the product handles (high and low priority, stale, unverified, duplicate and irrelevant signals). They are not counted above and never appear in &ldquo;Start here&rdquo;.
            Open one and press <strong className="font-medium text-ink">Open in email app</strong> on a draft: it opens in your own mail app, addressed to the test address.
          </p>
          <div className="mt-6 space-y-4">
            {demoRows.map((r) => <InvestorCard key={r.id} r={r} />)}
          </div>
        </section>
      )}
    </>
  );
}
