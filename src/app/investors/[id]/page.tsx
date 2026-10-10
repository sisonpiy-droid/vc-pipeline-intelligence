import Link from "next/link";
import { notFound } from "next/navigation";
import { SignalCard } from "@/components/SignalCard";
import { Bar, Card, ExternalLink, PageTitle, Pill, ScoreBadge, SetupError } from "@/components/ui";
import { ACTION_LABEL, ACTION_TONE, ENTITY_LABEL, REL_LABEL, STATE_META, ago, explainError, fmtDate, fmtDateTime, hostOf } from "@/lib/format";
import { load, today } from "@/lib/page";
import { getInvestor } from "@/lib/read";

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

function Dl({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
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
  const { inv: i, signals, latest, coverage, state } = res.data;
  const st = STATE_META[state];
  const hide = process.env.HIDE_PRIVATE_NOTES === "1";

  const verified = signals.filter((s) => s.verification_status === "verified");
  const review = signals.filter((s) => s.verification_status === "needs_review");
  const rejected = signals.filter((s) => s.verification_status === "rejected");
  const outcome = latest?.outcome as { breakdown?: Record<string, { points: number; max: number; note: string }>; explanation?: string } | null | undefined;
  const history = (i.contact_history as { date?: string | null; channel?: string; note?: string }[]) ?? [];
  const action = i.recommended_action as string | null;
  const untouched = i.relationship_status === "not_contacted"; // the workbook's placeholder only applies until the founder sets a real status
  const flags = ((i.data_flags as string[]) ?? []).filter((f) => f !== "relationship_status_placeholder" || untouched);
  const sectors = (i.sectors as string[]) ?? [];
  const sources = (i.source_urls as string[]) ?? [];

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/pipeline" className="text-accent hover:underline">← Pipeline</Link></p>
      <PageTitle
        title={String(i.firm_name)}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Pill>{ENTITY_LABEL[i.entity_type as string]}</Pill>
            {i.role_title ? <span>{String(i.role_title)}</span> : null}
            {i.website_url ? <ExternalLink href={i.website_url as string}>{hostOf(i.website_url as string)}</ExternalLink> : null}
            {i.profile_url ? <ExternalLink href={i.profile_url as string}>profile</ExternalLink> : null}
          </span>
        }
      />

      {/* Recommendation */}
      <Card className="p-5">
        <div className="flex flex-wrap gap-5">
          <ScoreBadge score={i.follow_up_score as number | null} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={st.tone} title={st.help}>{st.label}</Pill>
              {action && <Pill tone={ACTION_TONE[action]}>{ACTION_LABEL[action]}</Pill>}
              {latest?.status === "failed" && <Pill tone="bad">Last refresh failed</Pill>}
            </div>
            <p className="mt-2 text-sm">{(i.signal_summary as string | null) ?? "Not refreshed yet."}</p>
            {outcome?.explanation && <p className="mt-2 text-sm text-muted">{outcome.explanation}</p>}
            {latest?.status === "failed" && (
              <p className="mt-2 text-sm text-bad">{explainError(latest.error).title}. <span className="text-muted">{explainError(latest.error).action}</span></p>
            )}
            <p className="mt-2 text-xs text-muted">
              Last checked {latest?.finished_at ? `${fmtDateTime(latest.finished_at)} (${ago(latest.finished_at)})` : "never"} · Last relevant signal {fmtDate(i.last_signal_date as string | null)}
            </p>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Score breakdown */}
        <Card className="p-5">
          <h2 className="text-base font-semibold">Score breakdown</h2>
          <p className="mb-3 mt-1 text-xs text-muted">Computed by fixed rules (see docs/SCORING.md), not by the AI. Recency, relevance, evidence, fit and relationship are scored separately.</p>
          {outcome?.breakdown ? (
            <div className="space-y-3">{ORDER.filter((k) => outcome.breakdown![k]).map((k) => <Bar key={k} label={k} {...outcome.breakdown![k]!} />)}</div>
          ) : (
            <p className="text-sm text-muted">No score yet — this investor has not completed a refresh.</p>
          )}
        </Card>

        {/* Profile */}
        <Card className="p-5">
          <h2 className="mb-3 text-base font-semibold">Profile</h2>
          <Dl
            rows={[
              ["Stage", (i.stage_preference as string) ?? <span className="text-muted">unknown</span>],
              ["Sectors", sectors.length ? <span className="flex flex-wrap gap-1">{sectors.map((s) => <Pill key={s}>{s}</Pill>)}</span> : <span className="text-muted">none recorded</span>],
              ["Geography", (i.geography as string) ?? <span className="text-muted">unknown</span>],
              [
                "Thesis",
                i.thesis_verified ? (
                  <><Pill tone="good">Verified</Pill> <span className="block mt-1">{String(i.investment_thesis)}</span></>
                ) : i.fit_rationale ? (
                  <><Pill tone="warn">Unverified — from workbook</Pill> <span className="block mt-1">{String(i.fit_rationale)}</span></>
                ) : <span className="text-muted">none recorded</span>,
              ],
              ["Partner", i.partner_name ? <>{String(i.partner_name)} <span className="text-xs text-muted">(entered by you)</span></> : <span className="text-muted">None verified — none shown rather than guessed</span>],
              ...(((i.notable_investments as string[]) ?? []).length ? [["Notable investments", (i.notable_investments as string[]).join(", ")] as [string, React.ReactNode]] : []),
              ["Verification", <><Pill tone={i.verification_status === "unverified" ? "warn" : "good"}>{String(i.verification_status).replace("_", " ")}</Pill>{i.verification_note ? <span className="block mt-1 text-muted">{String(i.verification_note)}</span> : null}</>],
              ["Sources", sources.length ? <ul className="space-y-1">{sources.map((u) => <li key={u}><ExternalLink href={u}>{hostOf(u)}</ExternalLink></li>)}</ul> : <span className="text-muted">none</span>],
            ]}
          />
          {flags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {flags.map((f) => <Pill key={f} tone="neutral" title="Data quality flag from import">{FLAG_LABEL[f] ?? f}</Pill>)}
            </div>
          )}
        </Card>
      </div>

      {/* Signals */}
      <h2 className="mb-3 mt-8 text-lg font-semibold">Signal timeline</h2>
      {verified.length === 0 && review.length === 0 ? (
        <Card className="p-5 text-sm text-muted">
          No verified signal on record. {state === "failed" ? "The last search failed, so this is unknown rather than quiet." : state === "quiet_complete" ? "Every source answered and found nothing relevant in the last 30 days." : ""}
        </Card>
      ) : (
        <div className="space-y-3">
          {[...review, ...verified].map((s) => <SignalCard key={s.id} s={s} showInvestor={false} />)}
        </div>
      )}
      {rejected.length > 0 && (
        <details className="mt-3 rounded-xl border border-line bg-surface p-4 text-sm">
          <summary className="font-medium">{rejected.length} candidate{rejected.length > 1 ? "s" : ""} rejected (kept for audit and to avoid re-checking)</summary>
          <ul className="mt-3 space-y-2">
            {rejected.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
                <Pill tone="neutral">{(s.rejection_reason ?? "rejected").replace(/_/g, " ")}</Pill>
                <ExternalLink href={s.url}>{s.headline}</ExternalLink>
                <span className="text-xs text-muted">{fmtDate(s.published_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Relationship — read only */}
      <h2 className="mb-1 mt-8 text-lg font-semibold">Relationship &amp; notes</h2>
      <p className="mb-3 text-sm text-muted">Read-only here. This is your data: the refresh pipeline cannot read or change it (enforced by the database role it runs as).</p>
      <Card className="p-5">
        {hide ? (
          <p className="text-sm text-muted">Hidden on this public deployment (HIDE_PRIVATE_NOTES is set).</p>
        ) : (
          <Dl
            rows={[
              ["Status", <><Pill tone="info">{REL_LABEL[i.relationship_status as string]}</Pill>{untouched && flags.includes("relationship_status_placeholder") && <span className="ml-2 text-xs text-muted">(workbook default — replace with real data)</span>}</>],
              ["Last contact", fmtDate(i.last_contact_date as string | null)],
              ["Contact history", history.length ? <ul className="space-y-1">{history.map((h, n) => <li key={n}><span className="text-muted">{h.date ? fmtDate(h.date) : "undated"}{h.channel ? ` · ${h.channel}` : ""}</span> — {h.note}</li>)}</ul> : <span className="text-muted">None recorded</span>],
              ["Personal notes", i.personal_notes ? <span className="whitespace-pre-wrap">{String(i.personal_notes)}</span> : <span className="text-muted">None recorded</span>],
            ]}
          />
        )}
      </Card>

      {/* Coverage */}
      <h2 className="mb-3 mt-8 text-lg font-semibold">Source coverage</h2>
      {coverage.length === 0 ? (
        <Card className="p-5 text-sm text-muted">No sources have been checked yet.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Per-source retrieval status for this investor</caption>
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr><th scope="col" className="px-4 py-2 font-medium">Source</th><th scope="col" className="px-3 py-2 font-medium">Status</th><th scope="col" className="px-3 py-2 font-medium">Results</th><th scope="col" className="px-3 py-2 font-medium">Checked</th><th scope="col" className="px-3 py-2 font-medium">Note</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {coverage.map((c) => (
                <tr key={c.source}>
                  <th scope="row" className="px-4 py-2 font-medium">{c.source.replace(/_/g, " ")}</th>
                  <td className="px-3 py-2"><Pill tone={c.status === "ok" ? "good" : c.status === "error" ? "bad" : "neutral"}>{c.status === "empty" ? "searched, nothing found" : c.status}</Pill></td>
                  <td className="px-3 py-2 tabular-nums">{c.result_count}</td>
                  <td className="px-3 py-2 text-muted">{ago(c.checked_at)}</td>
                  <td className="px-3 py-2 text-muted">{c.error_category ? `${c.error_category}${c.note ? ` — ${c.note}` : ""}` : c.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
