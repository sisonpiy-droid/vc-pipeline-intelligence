import Link from "next/link";
import type { CSSProperties } from "react";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { ACTION_LABEL, ACTION_TONE, CONFIDENCE_TONE, ENTITY_LABEL, REL_LABEL, SECTOR_LABEL, STATE_META, TIER_LABEL, TYPE_LABEL, fmtDate, hostOf } from "@/lib/format";
import { displayStatus, type PipelineRow } from "@/lib/read";
import { CopyButton } from "./CopyButton";
import { Interactive } from "./motion/Interactive";
import { Fresh } from "./Fresh";
import { Bar, Card, ExternalLink, Pill, ScoreBadge } from "./ui";

const ORDER = ["recency", "relevance", "evidence", "fit", "relationship"];

/** One investor in the priority queue: the decision, the evidence behind it, and the maths on request. */
export function InvestorCard({ r, rank }: { r: PipelineRow; rank?: number }) {
  const st = STATE_META[r.state];
  const i = rank ?? 0;
  return (
    <div className="reveal" style={{ "--i": Math.min(i, 8) } as CSSProperties}>
      <Interactive>
      <Card className="p-5 transition-colors hover:border-accent/50 sm:p-6">
        <div className="flex gap-5 sm:gap-7">
          <ScoreBadge score={r.follow_up_score} index={i} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              {rank !== undefined && <span className="num text-xs text-muted">{String(rank).padStart(2, "0")}</span>}
              <Link href={`/investors/${r.id}`} className="text-[1.05rem] font-semibold tracking-tight hover:underline">{r.firm_name}</Link>
              <Pill href={`/pipeline?entity=${r.entity_type}`}>{ENTITY_LABEL[r.entity_type] ?? r.entity_type}</Pill>
              <Pill tone={st.tone} title={st.help} href={`/pipeline?state=${displayStatus(r.state)}`}>{st.label}</Pill>
              {r.relationship_status !== "not_contacted" && <Pill tone="info" href={`/pipeline?relationship=${r.relationship_status}`}>{REL_LABEL[r.relationship_status]}</Pill>}
            </div>

            {r.lead ? (
              <div className="mt-3">
                <p className="text-[0.95rem] font-medium leading-snug">
                  {r.lead.headline}
                  {r.lead.raw_headline && <span className="ml-1.5 align-middle text-[0.65rem] font-normal uppercase tracking-wide text-muted" title={`Written by Gemini from the evidence excerpt, because the page title was "${r.lead.raw_headline}"`}>summarised</span>}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <Link href={`/signals?category=${r.lead.signal_type ?? "other"}`} className="hover:text-ink hover:underline">{TYPE_LABEL[r.lead.signal_type ?? "other"] ?? "Signal"}</Link>
                  <span aria-hidden>·</span>
                  <span className="num">{fmtDate(r.lead.published_at)}</span>
                  <span aria-hidden>·</span>
                  <ExternalLink href={r.lead.url}>{hostOf(r.lead.url)}</ExternalLink>
                  {r.lead.confidence && <Pill tone={CONFIDENCE_TONE[r.lead.confidence]}>{r.lead.confidence} confidence</Pill>}
                  {r.lead.sector_match && <Pill tone={SECTOR_LABEL[r.lead.sector_match]!.tone} title={SECTOR_LABEL[r.lead.sector_match]!.help}>{SECTOR_LABEL[r.lead.sector_match]!.label}</Pill>}
                  {r.lead.new_capital && <Pill tone="good" title="The investor announced a new fund, a close, or a bigger cheque ceiling">New capital</Pill>}
                  {r.lead.tier !== "other" && <Pill tone={TIER_LABEL[r.lead.tier]!.tone} title={TIER_LABEL[r.lead.tier]!.help}>{TIER_LABEL[r.lead.tier]!.label}</Pill>}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">{r.signal_summary ?? "No signal recorded yet."}</p>
            )}

            {r.lead?.why && <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-muted"><span className="font-medium text-ink">Why it matters. </span>{r.lead.why}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {r.recommended_action && <Pill tone={ACTION_TONE[r.recommended_action]} href={`/pipeline?action=${r.recommended_action}`}>{ACTION_LABEL[r.recommended_action]}</Pill>}
              {r.refresh_failed && <Pill tone="bad" title="The most recent refresh failed; showing the last good result">Last refresh failed</Pill>}
              <Fresh at={r.last_checked} />
            </div>

            {r.capped_by.length > 0 && (
              <p role="note" className="mt-3 max-w-[70ch] rounded-lg border border-warn/30 bg-warn-soft/60 px-3 py-2 text-xs leading-relaxed text-warn">
                <strong className="font-semibold">Not “reach out now” yet:</strong> {r.capped_by.join("; ")}.
              </p>
            )}

            {r.angle && (
              <div className="mt-4 rounded-xl border border-accent/30 bg-good-soft/40 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-good">Suggested opening angle</p>
                  <CopyButton text={r.angle} />
                </div>
                <p className="mt-1.5 text-sm leading-relaxed">{r.angle}</p>
                <p className="mt-1.5 text-[0.7rem] text-muted">Drafted by Gemini from the verified signal above only. Edit before using; nothing is sent.</p>
              </div>
            )}

            {r.explanation && (
              <details className="group mt-4 border-t border-line pt-3 text-sm">
                <summary className="inline-flex list-none items-center gap-1 font-medium text-accent [&::-webkit-details-marker]:hidden">
                  <CaretRight aria-hidden size={12} weight="bold" className="transition-transform duration-200 group-open:rotate-90" />
                  Why this score
                </summary>
                <p className="mt-3 max-w-[70ch] leading-relaxed text-muted">{r.explanation}</p>
                {r.breakdown && (
                  <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    {ORDER.filter((k) => r.breakdown![k]).map((k, n) => (
                      <Bar key={k} label={k} index={n} {...r.breakdown![k]!} />
                    ))}
                  </div>
                )}
              </details>
            )}
          </div>
        </div>
      </Card>
      </Interactive>
    </div>
  );
}
