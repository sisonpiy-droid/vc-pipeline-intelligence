import Link from "next/link";
import { CONFIDENCE_TONE, TYPE_LABEL, fmtDate, fmtDateTime } from "@/lib/format";
import type { FeedSignal } from "@/lib/read";
import { Card, ExternalLink, Pill } from "./ui";

/** One piece of evidence, with its provenance: where it came from, when it happened, when we fetched it. */
export function SignalCard({ s, showInvestor = true }: { s: FeedSignal; showInvestor?: boolean }) {
  const needsReview = s.verification_status === "needs_review";
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        {s.signal_type && <Pill tone="info">{TYPE_LABEL[s.signal_type] ?? s.signal_type}</Pill>}
        {needsReview ? (
          <Pill tone="warn" title="Evidence was found but could not be verified yet">Needs review{s.rejection_reason ? `: ${s.rejection_reason.replace(/_/g, " ")}` : ""}</Pill>
        ) : (
          <Pill tone="good">Verified</Pill>
        )}
        {s.evidence_confidence && <Pill tone={CONFIDENCE_TONE[s.evidence_confidence]}>{s.evidence_confidence} confidence</Pill>}
        {s.relevance_score !== null && <Pill tone={s.relevance_score >= 70 ? "good" : s.relevance_score >= 40 ? "info" : "neutral"}>relevance {s.relevance_score}</Pill>}
        {s.duplicates > 0 && <Pill tone="neutral" title="Other pages reporting the same event were merged into this one">+{s.duplicates} duplicate source{s.duplicates > 1 ? "s" : ""}</Pill>}
      </div>

      <h3 className="mt-2 text-base font-semibold">
        <ExternalLink href={s.url}>{s.headline}</ExternalLink>
      </h3>
      <p className="mt-1 text-xs text-muted">
        {showInvestor && (
          <>
            <Link href={`/investors/${s.investor_id}`} className="font-medium text-ink hover:underline">{s.firm_name}</Link>
            {" · "}
          </>
        )}
        {s.source_name ?? "unknown source"} · event/publication date <span className="font-medium text-ink">{fmtDate(s.published_at)}</span>
        {s.date_source === "search_estimate" && <span title="The page itself had no readable date; the search provider's estimate was used (it may be later than the true date)"> (estimated)</span>}
        {" · "}retrieved {fmtDateTime(s.retrieved_at)}
      </p>

      {s.evidence_excerpt && (
        <blockquote className="mt-3 border-l-2 border-accent pl-3 text-sm italic text-ink/90">“{s.evidence_excerpt}”</blockquote>
      )}
      {s.summary && <p className="mt-2 text-sm">{s.summary}</p>}
      {s.relevance_explanation && (
        <p className="mt-1 text-sm text-muted">
          <span className="font-medium text-ink">Why it matters: </span>
          {s.relevance_explanation}
        </p>
      )}
    </Card>
  );
}
