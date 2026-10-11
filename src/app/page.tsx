import Link from "next/link";
import { isDemoView } from "@/lib/demoData/mode";
import type { CSSProperties } from "react";
import { InvestorCard } from "@/components/InvestorCard";
import { TopPicks } from "@/components/TopPicks";
import { RefreshButton } from "@/components/RefreshButton";
import { CountUp } from "@/components/motion/CountUp";
import { HeroReveal } from "@/components/motion/HeroReveal";
import { Magnetic } from "@/components/motion/Magnetic";
import { Empty, Eyebrow, Pill, SetupError } from "@/components/ui";
import { ACTION_LABEL, REL_LABEL, ago, fmtDateTime } from "@/lib/format";
import { isOpenDemo } from "@/lib/demo";
import { load, today } from "@/lib/page";
import { topPicks } from "@/lib/picks";
import { getOverview, type PipelineRow } from "@/lib/read";
import { ACTION_THRESHOLDS, STARTUP, WEIGHTS } from "@/lib/scoring/score";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Priority queue · VC Pipeline Intelligence" } };

const HOLD = (r: PipelineRow) => r.recommended_action === "wait_for_response" || r.relationship_status === "passed" || r.relationship_status === "committed";
const idx = (n: number) => ({ "--i": n }) as CSSProperties;

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

  return (
    <>
      {/* Hero: the answer on the left, the arithmetic behind it as a ledger on the right */}
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
        <HeroReveal>
          <div data-hero className="js-hide"><Eyebrow>This week</Eyebrow></div>
          <h1 data-hero className="js-hide mt-3 max-w-[22ch] text-3xl font-semibold leading-[1.1] tracking-tight md:text-[2.6rem]">
            {never ? (
              "Nothing to rank until the first refresh runs"
            ) : counts.active === 0 ? (
              "No investor has a strong signal right now"
            ) : (
              <>
                <span className="num text-accent">{counts.active}</span> of {counts.total} investors have a fresh, relevant signal
              </>
            )}
          </h1>
          <p data-hero className="js-hide mt-4 max-w-[58ch] text-sm leading-relaxed text-muted">
            Ranked by a transparent follow-up score. Every recommendation links to the public evidence behind it, and investors with no verified signal are listed rather than hidden.
          </p>
          <div data-hero className="js-hide mt-6 flex flex-wrap items-center gap-3">
            {demo ? <span className="text-sm text-muted">Demo mode: use “Run simulated refresh” in the banner above.</span> : <Magnetic><RefreshButton needPass={!isOpenDemo()} /></Magnetic>}
            <Link href="/signals" className="press rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-ink">Browse all signals</Link>
          </div>
        </HeroReveal>

        <dl className="reveal divide-y divide-line border-y border-line" style={idx(1)}>
          <LedgerRow label="Tracked investors" hint={demo ? "6 synthetic demo accounts" : `50 VC firms and 32 angels${demoCount ? `; ${demoCount} labelled demo accounts are listed separately` : ""}`} value={counts.total} href="/pipeline" />
          <LedgerRow label="Active signal, last 30 days" hint="verified and relevant" value={counts.active} href="/pipeline?state=active" tone="text-good" />
          <LedgerRow label="No verified signal" hint="every source answered" value={counts.quiet} href="/quiet" />
          <LedgerRow label="Activity unknown" hint="failed or partial, never counted as quiet" value={unknown} href="/quiet" tone={unknown ? "text-warn" : ""} />
        </dl>
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

        <aside className="space-y-10 lg:sticky lg:top-28 lg:self-start">
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
