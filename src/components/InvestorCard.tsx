import Link from "next/link";
import { ACTION_LABEL, ACTION_TONE, CONFIDENCE_TONE, ENTITY_LABEL, REL_LABEL, STATE_META, TYPE_LABEL, fmtDate, hostOf } from "@/lib/format";
import type { PipelineRow } from "@/lib/read";
import { Bar, Card, ExternalLink, Pill, ScoreBadge } from "./ui";

const ORDER = ["recency", "relevance", "evidence", "fit", "relationship"];

/** One investor in the priority queue: the decision, the evidence behind it, and the maths on request. */
export function InvestorCard({ r, rank }: { r: PipelineRow; rank?: number }) {
  const st = STATE_META[r.state];
  return (
    <Card className="p-4">
      <div className="flex gap-4">
        <ScoreBadge score={r.follow_up_score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {rank !== undefined && <span className="text-xs font-medium tabular-nums text-muted">#{rank}</span>}
            <Link href={`/investors/${r.id}`} className="text-base font-semibold hover:underline">{r.firm_name}</Link>
            <Pill>{ENTITY_LABEL[r.entity_type] ?? r.entity_type}</Pill>
            <Pill tone={st.tone} title={st.help}>{st.label}</Pill>
            {r.relationship_status !== "not_contacted" && <Pill tone="info">{REL_LABEL[r.relationship_status]}</Pill>}
          </div>

          {r.lead ? (
            <div className="mt-2">
              <p className="text-sm font-medium">{r.lead.headline}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <span>{TYPE_LABEL[r.lead.signal_type ?? "other"] ?? "Signal"}</span>
                <span aria-hidden>·</span>
                <span>{fmtDate(r.lead.published_at)}</span>
                <span aria-hidden>·</span>
                <ExternalLink href={r.lead.url}>{hostOf(r.lead.url)}</ExternalLink>
                {r.lead.confidence && <Pill tone={CONFIDENCE_TONE[r.lead.confidence]}>{r.lead.confidence} confidence</Pill>}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">{r.signal_summary ?? "No signal recorded yet."}</p>
          )}

          {r.lead?.why && (
            <p className="mt-2 text-sm">
              <span className="font-medium">Why it matters: </span>
              {r.lead.why}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {r.recommended_action && <Pill tone={ACTION_TONE[r.recommended_action]}>{ACTION_LABEL[r.recommended_action]}</Pill>}
            {r.refresh_failed && <Pill tone="bad" title="The most recent refresh failed; showing the last good result">Last refresh failed</Pill>}
          </div>

          {r.explanation && (
            <details className="mt-3 text-sm">
              <summary className="font-medium text-accent">Why this score</summary>
              <p className="mt-2 text-muted">{r.explanation}</p>
              {r.breakdown && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {ORDER.filter((k) => r.breakdown![k]).map((k) => (
                    <Bar key={k} label={k} {...r.breakdown![k]!} />
                  ))}
                </div>
              )}
            </details>
          )}
        </div>
      </div>
    </Card>
  );
}
