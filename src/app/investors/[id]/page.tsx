import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { notFound } from "next/navigation";
import { CaretLeft, Globe, LinkedinLogo, LockSimple, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { CompareToggle } from "@/components/CompareToggle";
import { CopyButton } from "@/components/CopyButton";
import { FounderEdit } from "@/components/FounderEdit";
import { ScoreTrend } from "@/components/ScoreTrend";
import { SignalCard } from "@/components/SignalCard";
import { TimelineLine } from "@/components/motion/TimelineLine";
import { Bar, Card, Eyebrow, ExternalLink, Pill, ScoreBadge, SetupError } from "@/components/ui";
import { ACTION_LABEL, ACTION_TONE, ENTITY_LABEL, REL_LABEL, STATE_META, ago, explainError, fmtDate, fmtDateTime, hostOf, linkedinSearchUrl, safeHref, webSearchUrl } from "@/lib/format";
import { isOpenDemo } from "@/lib/demo";
import { load, today } from "@/lib/page";
import { displayStatus, getInvestor } from "@/lib/read";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const ORDER = ["recency", "relevance", "evidence", "fit", "relationship"];
const FLAG_LABEL: Record<string, string> = {
  geography_unconfirmed: "Geography unconfirmed",
  thesis_unverified: "Thesis not verified",
  partner_unknown: "No partner recorded",
  no_website: "No website on record",
  name_cleaned: "Name whitespace cleaned on import",
  alias_split: "Combined name split into aliases",
  entity_type_heuristic: "Type inferred from text",
  relationship_status_placeholder: "Relationship status is the workbook's default",
};
const idx = (n: number) => ({ "--i": n }) as CSSProperties;

/** Stacked label / value rows divided by hairlines — a ledger, not a grid of boxes. */
function Ledger({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line border-y border-line text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="py-3">
          <dt className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-muted">{k}</dt>
          <dd className="mt-1 min-w-0 break-words leading-relaxed">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const res = /^[0-9a-f-]{36}$/i.test(id) ? await load((db) => getInvestor(db, id, today())) : null;
  return { title: res?.ok && res.data ? String(res.data.inv.firm_name) : "Investor" };
}

export default async function InvestorPage({ params }: Props) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await load((db) => getInvestor(db, id, today()));
  if (!res.ok) return <SetupError message={res.error} />;
  if (!res.data) notFound();
  const { inv: i, signals, latest, coverage, state, history: scoreHistory, portfolio } = res.data;
  const st = STATE_META[state];
  const hide = process.env.HIDE_PRIVATE_NOTES === "1";

  const verified = signals.filter((s) => s.verification_status === "verified");
  const review = signals.filter((s) => s.verification_status === "needs_review");
  const rejected = signals.filter((s) => s.verification_status === "rejected");
  const timeline = [...review, ...verified];
  // The latest scoring (a refresh or a re-score) is the source of the explanation, breakdown and opening angle.
  const cur = scoreHistory[0];
  const legacy = latest?.outcome as { breakdown?: Record<string, { points: number; max: number; note: string }>; explanation?: string } | null | undefined;
  const outcome = { breakdown: cur?.breakdown ?? legacy?.breakdown, explanation: cur?.explanation ?? legacy?.explanation, angle: cur?.angle ?? undefined };
  const chronological = [...scoreHistory].reverse().map((h) => ({ at: h.at, source: h.source, score: h.score, action: h.action, breakdown: h.breakdown }));
  const history = (i.contact_history as { date?: string | null; channel?: string; note?: string }[]) ?? [];
  const action = i.recommended_action as string | null;
  const untouched = i.relationship_status === "not_contacted"; // the workbook's placeholder only applies until the founder sets a real status
  const flags = ((i.data_flags as string[]) ?? []).filter((f) => f !== "relationship_status_placeholder" || untouched);
  const sectors = (i.sectors as string[]) ?? [];
  const sources = (i.source_urls as string[]) ?? [];
  const failedErr = latest?.status === "failed" ? explainError(latest.error) : null;

  return (
    <>
      <Link href="/pipeline" className="press inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <CaretLeft aria-hidden size={14} weight="bold" /> Pipeline
      </Link>

      {/* Hero: who they are and what to do, beside the score and the maths behind it */}
      <section className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="reveal">
          <Eyebrow>
            <Link href={`/pipeline?entity=${i.entity_type}`} className="hover:text-ink hover:underline">{ENTITY_LABEL[i.entity_type as string]}</Link>
            {i.role_title ? ` · ${String(i.role_title)}` : ""}
          </Eyebrow>
          <h1 className="mt-3 text-3xl font-semibold leading-[1.08] tracking-tight md:text-[2.75rem]">{String(i.firm_name)}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            {safeHref(i.website_url as string) ? (
              <a href={safeHref(i.website_url as string)!} target="_blank" rel="noopener noreferrer" className="press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 font-medium hover:border-accent">
                <Globe aria-hidden size={15} weight="bold" /> Website <span className="font-normal text-muted">{hostOf(i.website_url as string)}</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <a href={webSearchUrl(String(i.firm_name))} target="_blank" rel="noopener noreferrer" title="No website is on record; this searches the web for one" className="press inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1.5 font-medium text-muted hover:border-accent hover:text-ink">
                <MagnifyingGlass aria-hidden size={15} weight="bold" /> Find website
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            <a href={linkedinSearchUrl(String(i.firm_name), i.entity_type as string)} target="_blank" rel="noopener noreferrer" title="No LinkedIn URL is stored (none is guessed); this opens a LinkedIn search for them" className="press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 font-medium hover:border-accent">
              <LinkedinLogo aria-hidden size={15} weight="bold" /> LinkedIn
              <span className="sr-only"> search (opens in a new tab)</span>
            </a>
            {i.profile_url ? <ExternalLink href={i.profile_url as string}>source profile</ExternalLink> : null}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Pill tone={st.tone} title={st.help} href={`/pipeline?state=${displayStatus(state)}`}>{st.label}</Pill>
            {action && <Pill tone={ACTION_TONE[action]} href={`/pipeline?action=${action}`}>{ACTION_LABEL[action]}</Pill>}
            {latest?.status === "failed" && <Pill tone="bad">Last refresh failed</Pill>}
            <CompareToggle id={String(i.id)} name={String(i.firm_name)} />
          </div>

          <p className="mt-5 max-w-[60ch] text-lg font-medium leading-snug tracking-tight">{(i.signal_summary as string | null) ?? "Not refreshed yet."}</p>
          {outcome?.explanation && <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted">{outcome.explanation.replace(/\.{2}(?=\s)/g, ".")}</p>}
          {(cur?.capped_by?.length ?? 0) > 0 && (
            <p role="note" className="mt-3 max-w-[62ch] rounded-lg border border-warn/30 bg-warn-soft/60 px-3 py-2 text-xs leading-relaxed text-warn">
              <strong className="font-semibold">Why not “reach out now”:</strong> {cur!.capped_by.join("; ")}.
            </p>
          )}
          {outcome?.angle && action === "reach_out_now" && (
            <div className="mt-5 max-w-[62ch] rounded-xl border border-accent/30 bg-good-soft/40 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-good">Suggested opening angle</p>
                <CopyButton text={outcome.angle} />
              </div>
              <p className="mt-1.5 text-sm leading-relaxed">{outcome.angle}</p>
              <p className="mt-1.5 text-[0.7rem] text-muted">Drafted by Gemini from the verified evidence only. Edit before using; nothing is sent.</p>
            </div>
          )}
          {failedErr && (
            <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-bad">
              {failedErr.title}. <span className="text-muted">{failedErr.action}</span>
            </p>
          )}
          <p className="num mt-5 text-[0.7rem] leading-relaxed text-muted">
            Checked {latest?.finished_at ? `${fmtDateTime(latest.finished_at)} · ${ago(latest.finished_at)}` : "never"}
            <span aria-hidden> &nbsp;/&nbsp; </span>
            Last relevant signal {fmtDate(i.last_signal_date as string | null)}
          </p>
        </div>

        <div className="reveal" style={idx(1)}>
          <Card className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Eyebrow>Follow-up score</Eyebrow>
                <p className="mt-1.5 max-w-[28ch] text-xs leading-relaxed text-muted">Computed by fixed rules, not by the AI. Each factor is scored separately.</p>
              </div>
              <ScoreBadge score={i.follow_up_score as number | null} size="lg" />
            </div>
            {outcome?.breakdown ? (
              <div className="mt-6 space-y-4 border-t border-line pt-5">
                {ORDER.filter((k) => outcome.breakdown![k]).map((k, n) => (
                  <Bar key={k} label={k} index={n} {...outcome.breakdown![k]!} />
                ))}
              </div>
            ) : (
              <p className="mt-6 border-t border-line pt-5 text-sm text-muted">No score yet — this investor has not completed a refresh.</p>
            )}
            {chronological.length > 0 && <div className="mt-6 border-t border-line pt-5"><ScoreTrend chronological={chronological} /></div>}
          </Card>
        </div>
      </section>

      <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Evidence timeline */}
        <section aria-labelledby="timeline-h">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 id="timeline-h" className="text-lg font-semibold tracking-tight">Evidence timeline</h2>
            <span className="num text-xs text-muted">{verified.length} verified{review.length ? ` · ${review.length} to review` : ""}</span>
          </div>

          {timeline.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-sm leading-relaxed text-muted">
              No verified signal on record.{" "}
              {state === "failed"
                ? "The last search failed, so this is unknown rather than quiet."
                : state === "quiet_complete"
                  ? "Every source answered and found nothing relevant in the last 30 days."
                  : ""}
            </div>
          ) : (
            <ol className="relative space-y-6 border-l border-line pl-6 sm:pl-8">
              <TimelineLine />
              {timeline.map((s, n) => (
                <li key={s.id} className="reveal relative" style={idx(Math.min(n, 6))}>
                  <span aria-hidden className={`absolute -left-[1.9rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-bg sm:-left-[2.4rem] ${s.verification_status === "needs_review" ? "bg-warn" : "bg-accent"}`} />
                  <p className="num mb-2 text-xs text-muted">{fmtDate(s.published_at)}</p>
                  <SignalCard s={s} showInvestor={false} />
                </li>
              ))}
            </ol>
          )}

          {rejected.length > 0 && (
            <details className="mt-8 rounded-2xl border border-line p-4 text-sm">
              <summary className="font-medium">{rejected.length} candidate{rejected.length > 1 ? "s" : ""} rejected <span className="font-normal text-muted">(kept for audit, and so they are not re-checked)</span></summary>
              <ul className="mt-4 divide-y divide-line">
                {rejected.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                    <Pill tone="neutral">{(s.rejection_reason ?? "rejected").replace(/_/g, " ")}</Pill>
                    <ExternalLink href={s.url}>{s.headline}</ExternalLink>
                    <span className="num text-xs text-muted">{fmtDate(s.published_at)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* Rail */}
        <aside className="space-y-10 lg:sticky lg:top-28 lg:self-start">
          <section aria-labelledby="profile-h" className="reveal" style={idx(2)}>
            <Eyebrow>Profile</Eyebrow>
            <h2 id="profile-h" className="sr-only">Profile</h2>
            <div className="mt-3">
              <Ledger
                rows={[
                  ["Stage", (i.stage_preference as string) ?? <span className="text-muted">unknown</span>],
                  ["Sectors", sectors.length ? <span className="flex flex-wrap gap-1">{sectors.map((s) => <Pill key={s} href={`/pipeline?sector=${encodeURIComponent(s)}`}>{s}</Pill>)}</span> : <span className="text-muted">none recorded</span>],
                  ["Geography", (i.geography as string) ?? <span className="text-muted">unknown</span>],
                  [
                    "Thesis",
                    i.thesis_verified ? (
                      <>
                        <Pill tone="good">Verified</Pill>
                        <span className="mt-1.5 block">{String(i.investment_thesis)}</span>
                      </>
                    ) : i.fit_rationale ? (
                      <>
                        <Pill tone="warn">Unverified, from workbook</Pill>
                        <span className="mt-1.5 block text-muted">{String(i.fit_rationale)}</span>
                      </>
                    ) : (
                      <span className="text-muted">none recorded</span>
                    ),
                  ],
                  ["Partner", i.partner_name ? <>{String(i.partner_name)} <span className="text-xs text-muted">(entered by you)</span></> : <span className="text-muted">None verified, so none shown rather than guessed</span>],
                  ...(((i.notable_investments as string[]) ?? []).length ? ([["Notable investments", (i.notable_investments as string[]).join(", ")]] as [string, ReactNode][]) : []),
                  [
                    "Verification",
                    <>
                      <Pill tone={i.verification_status === "unverified" ? "warn" : "good"}>{String(i.verification_status).replace("_", " ")}</Pill>
                      {i.verification_note ? <span className="mt-1.5 block text-muted">{String(i.verification_note)}</span> : null}
                    </>,
                  ],
                  ["Sources", sources.length ? <ul className="space-y-1">{sources.map((u) => <li key={u}><ExternalLink href={u}>{hostOf(u)}</ExternalLink></li>)}</ul> : <span className="text-muted">none</span>],
                ]}
              />
            </div>
            {flags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {flags.map((f) => <Pill key={f} tone="neutral" title="Data-quality flag from import">{FLAG_LABEL[f] ?? f}</Pill>)}
              </div>
            )}
          </section>

          {portfolio.length > 0 && (
            <section aria-labelledby="pf-h" className="reveal" style={idx(3)}>
              <Eyebrow>Portfolio check</Eyebrow>
              <h2 id="pf-h" className="sr-only">Portfolio check</h2>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                {portfolio.length} companies from <ExternalLink href={portfolio[0]!.source_url}>the investor's own portfolio page</ExternalLink>, read {ago(portfolio[0]!.checked_at)}.
                {" "}{portfolio.filter((p) => p.logistics_related).length} are in logistics, each backed by a quote from the page. Informational: it does not change the score.
              </p>
              {portfolio.some((p) => p.competitor_risk === "direct") && (
                <p role="note" className="mt-3 rounded-lg border border-warn/30 bg-warn-soft/60 px-3 py-2 text-xs leading-relaxed text-warn">
                  <strong className="font-semibold">Possible conflict:</strong> a portfolio company sells software for logistics operations. Worth checking before you pitch.
                </p>
              )}
              <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
                {portfolio.filter((p) => p.logistics_related).map((p) => (
                  <li key={p.company} className="py-2.5">
                    <div className="flex items-center justify-between gap-3"><span className="font-medium">{p.company}</span><Pill tone={p.competitor_risk === "direct" ? "warn" : "info"}>{p.competitor_risk === "direct" ? "possible competitor" : "logistics"}</Pill></div>
                    {p.evidence && <p className="mt-1 text-xs italic leading-relaxed text-muted">“{p.evidence}”</p>}
                  </li>
                ))}
                {portfolio.filter((p) => !p.logistics_related).length > 0 && (
                  <li className="py-2.5 text-xs leading-relaxed text-muted">
                    <span className="font-medium text-ink">Also backs: </span>{portfolio.filter((p) => !p.logistics_related).map((p) => p.company).join(", ")}
                  </li>
                )}
              </ul>
            </section>
          )}

          <section aria-labelledby="rel-h" className="reveal" style={idx(3)}>
            <Eyebrow>Relationship &amp; notes</Eyebrow>
            <h2 id="rel-h" className="sr-only">Relationship and notes</h2>
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
              <LockSimple aria-hidden size={14} weight="bold" className="mt-px shrink-0" />
              This is your data. The refresh role cannot read or change it (enforced by the database); you edit it here.
            </p>
            <div className="mt-3">
              {hide ? (
                <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Hidden on this public deployment.</p>
              ) : (
                <Ledger
                  rows={[
                    [
                      "Status",
                      <>
                        <Pill tone="info" href={`/pipeline?relationship=${i.relationship_status}`}>{REL_LABEL[i.relationship_status as string]}</Pill>
                        {untouched && flags.includes("relationship_status_placeholder") && <span className="mt-1.5 block text-xs text-muted">Workbook default. Replace with real data.</span>}
                      </>,
                    ],
                    ["Last contact", <span className="num">{fmtDate(i.last_contact_date as string | null)}</span>],
                    [
                      "Contact history",
                      history.length ? (
                        <ul className="space-y-1.5">
                          {history.map((h, n) => (
                            <li key={n}>
                              <span className="num text-xs text-muted">{h.date ? fmtDate(h.date) : "undated"}{h.channel ? ` · ${h.channel}` : ""}</span>
                              <span className="block">{h.note}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-muted">None recorded</span>
                      ),
                    ],
                    ["Personal notes", i.personal_notes ? <span className="whitespace-pre-wrap">{String(i.personal_notes)}</span> : <span className="text-muted">None recorded</span>],
                  ]}
                />
              )}
              {!hide && (
                <FounderEdit id={String(i.id)} status={String(i.relationship_status)} lastContact={(i.last_contact_date as string | null) ?? null} notes={(i.personal_notes as string | null) ?? null} needPass={!isOpenDemo()} />
              )}
            </div>
          </section>

          <section aria-labelledby="cov-h" className="reveal" style={idx(4)}>
            <Eyebrow>Source coverage</Eyebrow>
            <h2 id="cov-h" className="sr-only">Source coverage</h2>
            {coverage.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No sources have been checked yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
                {coverage.map((c) => (
                  <li key={c.source} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium capitalize">{c.source.replace(/_/g, " ")}</span>
                      <Pill tone={c.status === "ok" ? "good" : c.status === "error" ? "bad" : "neutral"}>{c.status === "empty" ? "searched, nothing found" : c.status}</Pill>
                    </div>
                    <p className="num mt-1 text-xs text-muted">
                      {c.result_count} result{c.result_count === 1 ? "" : "s"} · {ago(c.checked_at)}
                    </p>
                    {(c.error_category || c.note) && <p className="mt-1 text-xs leading-relaxed text-muted">{c.error_category ? `${c.error_category}${c.note ? ` — ${c.note}` : ""}` : c.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
