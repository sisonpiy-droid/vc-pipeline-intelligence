import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { CONFIDENCE_TONE, SECTOR_LABEL, TYPE_LABEL, fmtDate, fmtDateTime, platformOf, safeHref, sourceTier } from "@/lib/format";
import type { FeedSignal } from "@/lib/read";
import { Card, Pill } from "./ui";

/**
 * One piece of evidence, read top to bottom: who and when, what happened, why it matters to this founder, the passage that
 * proves it. The labels (type, topic, trust) sit underneath, and the provenance details fold away until asked for.
 */
export function SignalCard({ s, showInvestor = true }: { s: FeedSignal; showInvestor?: boolean }) {
  const needsReview = s.verification_status === "needs_review";
  const tier = sourceTier(s.source_name, s.investor_website);
  const href = safeHref(s.url);
  const rel = s.relevance_score;
  const relTone = rel === null ? "bg-neutral/30" : rel >= 70 ? "bg-good" : rel >= 40 ? "bg-info" : "bg-muted/60";
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <p className="min-w-0 text-sm text-muted">
          {showInvestor && (
            <>
              <Link href={`/investors/${s.investor_id}`} className="font-semibold text-ink hover:underline">{s.firm_name}</Link>
              <span aria-hidden className="mx-2">·</span>
            </>
          )}
          <span className="num font-medium text-ink">{fmtDate(s.published_at)}</span>
          <span aria-hidden className="mx-2">·</span>
          {s.source_name ?? "unknown source"}
        </p>
        {rel !== null && (
          <div className="w-28 shrink-0" title="How relevant this is to your startup, 0 to 100">
            <div className="flex items-baseline justify-between text-xs text-muted"><span>Relevance</span><span className="num font-medium text-ink">{rel}</span></div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-soft"><div style={{ width: `${rel}%` }} className={`h-full rounded-full ${relTone}`} /></div>
          </div>
        )}
      </div>

      <h3 className="mt-3 text-lg font-semibold leading-snug tracking-tight">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="group text-ink transition-colors hover:text-accent">
            {s.headline}
            <ArrowUpRight aria-hidden size={14} weight="bold" className="ml-1 inline align-baseline text-muted transition-colors group-hover:text-accent" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : s.headline}
        {s.raw_headline && <span className="ml-2 align-middle text-[0.65rem] font-normal uppercase tracking-wide text-muted" title={`Written by Gemini from the excerpt; the page's own title is "${s.raw_headline}"`}>summarised</span>}
      </h3>

      {s.summary && <p className="mt-2 max-w-[75ch] text-[0.95rem] leading-relaxed">{s.summary}</p>}

      {s.relevance_explanation && (
        <div className="mt-4 max-w-[75ch] rounded-xl bg-neutral-soft/60 px-4 py-3">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted">Why it matters to you</p>
          <p className="mt-1 text-sm leading-relaxed">{s.relevance_explanation}</p>
        </div>
      )}

      {s.evidence_excerpt && (
        <blockquote className="mt-4 max-w-[75ch] border-l-2 border-accent/60 pl-4">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted">What the page says</p>
          <p className="mt-1 text-sm leading-relaxed text-ink/80">“{s.evidence_excerpt}”</p>
        </blockquote>
      )}
      {s.review_note && <p className="mt-3 text-sm text-warn">Review note: {s.review_note}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {needsReview ? (
          <Pill tone="warn" title="Evidence was found but could not be verified yet">Needs review{s.rejection_reason ? `: ${s.rejection_reason.replace(/_/g, " ")}` : ""}</Pill>
        ) : (
          <Pill tone="good">Verified</Pill>
        )}
        {s.evidence_confidence && <Pill tone={CONFIDENCE_TONE[s.evidence_confidence]}>{s.evidence_confidence} confidence</Pill>}
        {s.signal_type && <Pill tone="info" href={`/signals?category=${s.signal_type}`}>{TYPE_LABEL[s.signal_type] ?? s.signal_type}</Pill>}
        {s.sector_match && <Pill tone={SECTOR_LABEL[s.sector_match]!.tone} title={SECTOR_LABEL[s.sector_match]!.help}>{SECTOR_LABEL[s.sector_match]!.label}</Pill>}
        {s.new_capital && <Pill tone="good" title="The investor announced a new fund, a close, or a larger cheque ceiling: capital is available to deploy">New fund capital</Pill>}
        {tier === "official" && <Pill tone="good" title="Published on the investor's own website">Official source</Pill>}
        {tier === "press" && <Pill tone="neutral" title="A recognised news publication">Press</Pill>}
        {tier === "social" && <Pill tone="warn" title="A social-media post: counts less as evidence and cannot alone justify a cold approach">Social post</Pill>}
        {platformOf(s.source_name) && <Pill tone="neutral" title="Where this appeared">{platformOf(s.source_name)}</Pill>}
        {s.is_demo && <Pill tone="warn" title="Synthetic: no real page exists behind this link">Synthetic</Pill>}
        {s.duplicates > 0 && <Pill tone="neutral" title="Other pages reporting the same event were merged into this one">+{s.duplicates} duplicate source{s.duplicates > 1 ? "s" : ""}</Pill>}
      </div>

      <details className="mt-3">
        <summary className="inline-flex cursor-pointer text-xs font-medium text-muted hover:text-ink">Where this came from</summary>
        <p className="mt-2 max-w-[75ch] text-xs leading-relaxed text-muted">
          Source: {s.source_name ?? "unknown"}. Event or publication date {fmtDate(s.published_at)}
          {s.date_source === "feed" && " (dated by the investor's own RSS or Atom feed)"}
          {s.date_source === "post_id" && " (decoded from the LinkedIn post ID)"}
          {s.date_source === "search_estimate" && " (an estimate by the search provider: the page had no readable date, so the true date may be earlier)"}
          . Retrieved {fmtDateTime(s.retrieved_at)}.
        </p>
      </details>
    </Card>
  );
}
