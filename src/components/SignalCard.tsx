import Link from "next/link";
import { ArrowUpRight, CaretDown } from "@phosphor-icons/react/dist/ssr";
import { CONFIDENCE_TONE, SECTOR_LABEL, TYPE_LABEL, fmtDate, fmtDateTime, platformOf, safeHref, sourceTier } from "@/lib/format";
import type { FeedSignal } from "@/lib/read";
import { Pill } from "./ui";

/**
 * One piece of evidence. Closed, it is a single scannable row: relevance, headline, who and when. Opened (click anywhere on
 * the row), it shows the summary, why it matters, the passage from the page, the labels, and where it came from.
 */
export function SignalCard({ s, showInvestor = true, defaultOpen = false }: { s: FeedSignal; showInvestor?: boolean; defaultOpen?: boolean }) {
  const needsReview = s.verification_status === "needs_review";
  const tier = sourceTier(s.source_name, s.investor_website);
  const href = safeHref(s.url);
  const rel = s.relevance_score;
  const relTone = rel === null ? "text-muted" : rel >= 70 ? "text-good" : rel >= 40 ? "text-info" : "text-muted";
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-line bg-surface transition-colors open:border-accent/30 hover:border-accent/30">
      <summary className="flex cursor-pointer list-none items-start gap-3.5 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="w-9 shrink-0 text-center" title="Relevance to your startup, 0 to 100">
          <span className={`num block text-lg font-medium leading-none ${relTone}`}>{rel ?? "–"}</span>
          <span className="mt-1 block text-[0.6rem] uppercase tracking-wider text-muted">rel.</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-medium leading-snug">{s.headline}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {showInvestor && <span className="font-medium text-ink/80">{s.firm_name}</span>}
            <span className="num">{fmtDate(s.published_at)}</span>
            {s.signal_type && <span>{TYPE_LABEL[s.signal_type] ?? s.signal_type}</span>}
            {needsReview && <span className="font-medium text-warn">Needs review</span>}
            {s.new_capital && <span className="font-medium text-good">New fund capital</span>}
          </span>
        </span>
        <CaretDown aria-hidden size={14} weight="bold" className="mt-1 shrink-0 text-muted transition-transform duration-300 group-open:rotate-180" />
      </summary>

      <div className="space-y-4 border-t border-line px-4 pb-4 pt-4 text-sm sm:pl-[4.25rem]">
        {s.summary && <p className="max-w-[70ch] leading-relaxed">{s.summary}</p>}
        {s.relevance_explanation && (
          <p className="max-w-[70ch] leading-relaxed text-muted"><span className="font-medium text-ink">Why it matters: </span>{s.relevance_explanation}</p>
        )}
        {s.evidence_excerpt && (
          <blockquote className="max-w-[70ch] border-l-2 border-accent/60 pl-3 text-[0.85rem] leading-relaxed text-ink/75">“{s.evidence_excerpt}”</blockquote>
        )}
        {s.review_note && <p className="text-warn">Review note: {s.review_note}</p>}

        <div className="flex flex-wrap items-center gap-1.5">
          {needsReview ? <Pill tone="warn" title="Evidence was found but could not be verified yet">Needs review{s.rejection_reason ? `: ${s.rejection_reason.replace(/_/g, " ")}` : ""}</Pill> : <Pill tone="good">Verified</Pill>}
          {s.evidence_confidence && <Pill tone={CONFIDENCE_TONE[s.evidence_confidence]}>{s.evidence_confidence} confidence</Pill>}
          {s.sector_match && <Pill tone={SECTOR_LABEL[s.sector_match]!.tone} title={SECTOR_LABEL[s.sector_match]!.help}>{SECTOR_LABEL[s.sector_match]!.label}</Pill>}
          {tier === "official" && <Pill tone="good" title="Published on the investor's own website">Official source</Pill>}
          {tier === "press" && <Pill tone="neutral" title="A recognised news publication">Press</Pill>}
          {tier === "social" && <Pill tone="warn" title="A social-media post: counts less as evidence and cannot alone justify a cold approach">Social post</Pill>}
          {platformOf(s.source_name) && <Pill tone="neutral" title="Where this appeared">{platformOf(s.source_name)}</Pill>}
          {s.is_demo && <Pill tone="warn" title="Synthetic: no real page exists behind this link">Synthetic</Pill>}
          {s.duplicates > 0 && <Pill tone="neutral" title="Other pages reporting the same event were merged into this one">+{s.duplicates} duplicate source{s.duplicates > 1 ? "s" : ""}</Pill>}
        </div>

        <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              Open the source ({s.source_name ?? "link"}) <ArrowUpRight aria-hidden size={12} weight="bold" /><span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          {showInvestor && <Link href={`/investors/${s.investor_id}`} className="font-medium text-accent hover:underline">Open {s.firm_name}</Link>}
          <span>
            Dated {fmtDate(s.published_at)}
            {s.date_source === "feed" && " (from the investor's own feed)"}
            {s.date_source === "post_id" && " (decoded from the post ID)"}
            {s.date_source === "search_estimate" && " (estimated: the page had no readable date)"}
            {" · "}retrieved {fmtDateTime(s.retrieved_at)}
          </span>
          {s.raw_headline && <span title={`The page's own title is "${s.raw_headline}"`}>Headline written by Gemini from the excerpt</span>}
        </p>
      </div>
    </details>
  );
}
