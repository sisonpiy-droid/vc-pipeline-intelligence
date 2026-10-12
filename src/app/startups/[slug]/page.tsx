import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { RubricEditor } from "@/components/RubricEditor";
import { StartupActions } from "@/components/StartupActions";
import { Empty, ExternalLink, Eyebrow, Pill, SetupError } from "@/components/ui";
import { isOpenDemo } from "@/lib/demo";
import { ACTION_LABEL, ACTION_TONE, fmtDate, type Tone } from "@/lib/format";
import { load } from "@/lib/page";
import { getResults, type ResultRow } from "@/lib/startups/read";
import { SECTOR_KEYS, SECTOR_LABEL, STAGE_LABEL } from "@/lib/startups/rubric";
import { getStartup, getSteps } from "@/lib/startups/store";
import { statusOf, WORKFLOW } from "@/lib/startups/workflow";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: `Startup ${(await params).slug}` };
}

const STATUS_TONE: Record<string, Tone> = { done: "good", partial: "warn", failed: "bad", running: "info", pending: "neutral" };
const STATUS_LABEL: Record<string, string> = { done: "Done", partial: "Needs attention", failed: "Failed", running: "Running", pending: "Not run yet" };
const GROUPS: { actions: string[]; title: string; open: boolean }[] = [
  { actions: ["reach_out_now"], title: "Reach out now", open: true },
  { actions: ["prepare_targeted_outreach"], title: "Prepare targeted outreach", open: true },
  { actions: ["research_further"], title: "Research further", open: false },
  { actions: ["wait_for_response", "no_action"], title: "No action now", open: false },
];

export default async function StartupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const res = await load(async (db) => {
    const s = await getStartup(db, slug);
    if (!s) return null;
    return { s, steps: await getSteps(db, s.id), results: await getResults(db, s.id) };
  });
  if (!res.ok) return <SetupError message={res.error} />;
  if (!res.data) notFound();
  const { s, steps, results } = res.data;
  const r = s.rubric;
  const running = steps.some((x) => x.status === "running" && x.started_at && Date.now() - new Date(x.started_at).getTime() < 10 * 60_000);
  const needPass = !isOpenDemo();

  return (
    <>
      <AutoRefresh active={running} />
      <p className="mb-4 text-sm"><Link href="/startups" className="text-accent hover:underline">← All startups</Link></p>
      <div className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
        <p className="mt-1.5 max-w-[70ch] text-sm leading-relaxed text-muted">{s.pitch}</p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{s.sector}</span><span aria-hidden>·</span><span>{STAGE_LABEL[s.stage]}</span><span aria-hidden>·</span><span>{s.geography}</span>
          {s.round_size && <><span aria-hidden>·</span><span>{s.round_size}</span></>}
        </p>
        {s.ask && <p className="mt-1 text-xs text-muted">Wants from investors: {s.ask}</p>}
      </div>

      {/* ───────── workflow ───────── */}
      <section aria-labelledby="wf-h" className="mb-14">
        <Eyebrow>Workflow</Eyebrow>
        <h2 id="wf-h" className="mt-1 text-lg font-semibold tracking-tight">What happens to this startup, step by step</h2>
        <ol className="mt-5 divide-y divide-line border-y border-line">
          {WORKFLOW.map((w, i) => {
            const st = statusOf(w.key, steps, results.length > 0);
            return (
              <li key={w.key} className="grid gap-x-4 gap-y-2 py-5 sm:grid-cols-[2rem_1fr_auto]">
                <span className="num text-sm text-muted">{i + 1}</span>
                <div className="min-w-0">
                  <p className="font-medium">{w.title} <span className="ml-1 text-xs font-normal text-muted">by {w.by} · {w.cost}</span></p>
                  <p className="mt-1 max-w-[75ch] text-sm leading-relaxed text-muted">{w.what}</p>
                  {st.detail && <p className="mt-2 max-w-[75ch] rounded-lg bg-neutral-soft/60 px-3 py-2 text-sm leading-relaxed">{st.detail}</p>}
                </div>
                <div className="sm:text-right"><Pill tone={STATUS_TONE[st.status]}>{STATUS_LABEL[st.status]}</Pill></div>
              </li>
            );
          })}
        </ol>
        <div className="mt-6">
          <StartupActions slug={s.slug} needPass={needPass} running={running} hasResults={results.length > 0} />
        </div>
      </section>

      {/* ───────── rubric ───────── */}
      <section aria-labelledby="rb-h" className="mb-14">
        <Eyebrow>Rubric</Eyebrow>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h2 id="rb-h" className="text-lg font-semibold tracking-tight">How this startup scores investors</h2>
          <Pill tone={s.rubric_source === "default" ? "warn" : "info"}>{s.rubric_source === "gemini" ? "Written by Gemini, checked by code" : s.rubric_source === "edited" ? "Edited by you" : "Default (Gemini unavailable)"}</Pill>
        </div>
        {s.rubric_source === "default" && s.rubric_note && <p className="mt-2 text-sm text-warn">Gemini could not write this rubric ({s.rubric_note.replace(/_/g, " ")}), so this is a plain default built from the profile.</p>}

        <div className="mt-6 grid gap-x-12 gap-y-8 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">Weights (total 100)</h3>
            <dl className="mt-3 space-y-2.5">
              {(Object.entries(r.weights) as [string, number][]).map(([k, v]) => (
                <div key={k}>
                  <div className="flex justify-between text-sm"><dt className="capitalize">{k}</dt><dd className="num text-muted">{v}</dd></div>
                  <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-neutral-soft"><div style={{ width: `${(v / 60) * 100}%` }} className="h-full rounded-full bg-accent" /></div>
                </div>
              ))}
            </dl>
            <p className="mt-3 max-w-[60ch] text-xs leading-relaxed text-muted">{r.rationale.weights}</p>
          </div>
          <div>
            <h3 className="text-sm font-medium">Actions</h3>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt>Reach out now</dt><dd className="num text-muted">score ≥ {r.thresholds.reachOutNow}, lead signal relevance ≥ {r.reachOutMinRelevance}</dd></div>
              <div className="flex justify-between"><dt>Prepare targeted outreach</dt><dd className="num text-muted">score ≥ {r.thresholds.prepareOutreach}</dd></div>
            </dl>
            <p className="mt-3 max-w-[60ch] text-xs leading-relaxed text-muted">{r.rationale.thresholds}</p>
            <h3 className="mt-6 text-sm font-medium">Investor fit</h3>
            <p className="mt-2 max-w-[60ch] text-xs leading-relaxed text-muted">{r.rationale.fit}</p>
            <p className="mt-2 text-xs text-muted">Sector terms: <span className="text-ink">{r.fit.coreTerms.join(", ") || "none"}</span> · Geography: <span className="text-ink">{r.fit.geographyTerms.join(", ") || "anywhere"}</span></p>
          </div>
        </div>

        <h3 className="mt-8 text-sm font-medium">Topic classes</h3>
        <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-muted">{r.rationale.sector}</p>
        <dl className="mt-3 divide-y divide-line border-y border-line text-sm">
          {SECTOR_KEYS.map((k) => (
            <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[12rem_1fr_6rem]">
              <dt className="font-medium">{SECTOR_LABEL[k]}</dt>
              <dd className="text-muted">{r.definitions[k]}</dd>
              <dd className="num text-muted sm:text-right">max relevance {r.sectorCap[k]}</dd>
            </div>
          ))}
        </dl>

        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-accent">Edit the rubric</summary>
          <div className="mt-4"><RubricEditor slug={s.slug} rubric={r} needPass={needPass} /></div>
        </details>
      </section>

      {/* ───────── shortlist ───────── */}
      <section aria-labelledby="sl-h">
        <Eyebrow>Shortlist</Eyebrow>
        <h2 id="sl-h" className="mt-1 text-lg font-semibold tracking-tight">Investors for {s.name}</h2>
        {results.length === 0 ? (
          <div className="mt-5">
            <Empty title="Not evaluated yet">
              Press “Run evaluation” above. Until then no investor has a score for this startup; nothing here is a placeholder.
            </Empty>
          </div>
        ) : (
          <div className="mt-5 space-y-8">
            {GROUPS.map((g) => {
              const rows = results.filter((x) => g.actions.includes(x.action));
              if (rows.length === 0) return null;
              return (
                <details key={g.title} open={g.open}>
                  <summary className="cursor-pointer text-sm font-medium">{g.title} <span className="num font-normal text-muted">({rows.length})</span></summary>
                  <ul className="mt-3 divide-y divide-line border-y border-line">
                    {rows.map((x) => <Row key={x.investor_id} x={x} />)}
                  </ul>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function Row({ x }: { x: ResultRow }) {
  return (
    <li className="py-4">
      <div className="flex items-start gap-4">
        <span className="num w-12 shrink-0 text-3xl font-medium leading-none">{x.score}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{x.firm_name}</span>
            <Pill tone={ACTION_TONE[x.action] ?? "neutral"}>{ACTION_LABEL[x.action] ?? x.action}</Pill>
            {x.coverage === "partial" && <Pill tone="warn" title="Some sources failed or evidence is unjudged: absence of a signal is not conclusive">Not conclusive</Pill>}
          </p>
          {x.lead ? (
            <p className="mt-1.5 text-sm leading-relaxed">
              <ExternalLink href={x.lead.url}>{x.lead.headline}</ExternalLink>
              <span className="ml-2 text-xs text-muted">{x.lead.source_name ?? "source"} · {fmtDate(x.lead.published_at)}{x.lead.relevance !== null && ` · relevance ${x.lead.relevance}/100${x.lead.sector_match ? ` (${SECTOR_LABEL[x.lead.sector_match as keyof typeof SECTOR_LABEL] ?? x.lead.sector_match})` : ""}`}</span>
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-muted">No relevant signal in the last 30 days{x.evidence_count ? ` (${x.evidence_count} checked)` : ""}.</p>
          )}
          {x.explanation && <p className="mt-1.5 max-w-[80ch] text-sm leading-relaxed text-muted">{x.explanation}</p>}
          {x.note && <p className="mt-1.5 text-sm text-warn">{x.note}</p>}
          {x.capped_by.length > 0 && <p className="mt-1.5 text-xs text-muted">Held back from “reach out now”: {x.capped_by.join("; ")}.</p>}
          {x.breakdown && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-accent">Score breakdown</summary>
              <dl className="mt-2 space-y-1 text-xs">
                {Object.entries(x.breakdown).map(([k, c]) => (
                  <div key={k} className="grid grid-cols-[6rem_4rem_1fr] gap-2"><dt className="capitalize">{k}</dt><dd className="num text-muted">{c.points} / {c.max}</dd><dd className="text-muted">{c.note}</dd></div>
                ))}
              </dl>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}
