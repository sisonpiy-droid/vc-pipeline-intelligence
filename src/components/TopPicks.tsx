import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { ACTION_LABEL, SECTOR_LABEL, TIER_LABEL, fmtDate, hostOf } from "@/lib/format";
import type { Pick } from "@/lib/picks";
import { CopyButton } from "./CopyButton";
import { Interactive } from "./motion/Interactive";
import { Fresh } from "./Fresh";
import { Eyebrow, ExternalLink, Pill, ScoreBadge } from "./ui";

/** The decision up front: the few investors worth an email this week, each with its evidence and an opening line. */
export function TopPicks({ picks }: { picks: Pick[] }) {
  if (picks.length === 0) return null;
  const [first, ...rest] = picks;
  return (
    <section aria-labelledby="picks-h" className="mt-12">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Eyebrow>Start here</Eyebrow>
          <h2 id="picks-h" className="mt-1 text-xl font-semibold tracking-tight">{picks.length === 1 ? "The one investor to email this week" : `${picks.length} investors to email this week`}</h2>
        </div>
        <p className="max-w-[48ch] text-xs leading-relaxed text-muted">
          Chosen by the same score, then by the quality of the evidence: own-site and press beat social posts, logistics beats general seed news.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <PickCard pick={first!} n={1} big />
        {rest.length > 0 && (
          <ol className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {rest.map((p, i) => (
              <li key={p.row.id} className="reveal p-4" style={{ "--i": i + 1 } as CSSProperties}>
                <PickRow pick={p} n={i + 2} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Chips({ pick }: { pick: Pick }) {
  const l = pick.row.lead;
  if (!l) return null;
  const sector = l.sector_match ? SECTOR_LABEL[l.sector_match] : null;
  const tier = TIER_LABEL[l.tier]!;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {sector && <Pill tone={sector.tone} title={sector.help}>{sector.label}</Pill>}
      {l.new_capital && <Pill tone="good" title="The investor announced a new fund, a close, or a bigger cheque ceiling">New capital</Pill>}
      <Pill tone={tier.tone} title={tier.help}>{tier.label}</Pill>
    </span>
  );
}

function PickCard({ pick, n, big }: { pick: Pick; n: number; big?: boolean }) {
  const r = pick.row;
  const l = r.lead;
  return (
    <Interactive>
      <div className="reveal card-shadow h-full rounded-2xl border border-accent/40 bg-surface p-5 sm:p-6" style={{ "--i": 0 } as CSSProperties}>
        <div className="flex gap-5">
          <ScoreBadge score={r.follow_up_score} size={big ? "lg" : "md"} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-xs text-muted">{String(n).padStart(2, "0")}</span>
              <Link href={`/investors/${r.id}`} className="text-xl font-semibold tracking-tight hover:underline">{r.firm_name}</Link>
              {pick.basis === "prepare_targeted_outreach" && <Pill tone="info" title="No investor clears 'reach out now' yet; this is the strongest case for preparing a message">Prepare first</Pill>}
            </div>
            {l && (
              <>
                <p className="mt-3 text-[0.95rem] font-medium leading-snug">{l.headline}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span className="num">{fmtDate(l.published_at)}</span><span aria-hidden>·</span>
                  <ExternalLink href={l.url}>{hostOf(l.url)}</ExternalLink>
                </p>
                <div className="mt-2.5"><Chips pick={pick} /></div>
                {l.why && <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted">{l.why}</p>}
              </>
            )}
            {r.angle && (
              <div className="mt-4 rounded-xl border border-accent/30 bg-good-soft/40 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-good">Opening line</p>
                  <CopyButton text={r.angle} />
                </div>
                <p className="mt-1.5 text-sm leading-relaxed">{r.angle}</p>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
              <Link href={`/investors/${r.id}`} className="press inline-flex items-center gap-1 font-medium text-accent hover:underline">Open the evidence <ArrowRight aria-hidden size={12} weight="bold" /></Link>
              <Fresh at={r.last_checked} />
            </div>
          </div>
        </div>
      </div>
    </Interactive>
  );
}

function PickRow({ pick, n }: { pick: Pick; n: number }) {
  const r = pick.row;
  const l = r.lead;
  return (
    <div className="flex gap-4">
      <ScoreBadge score={r.follow_up_score} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="num text-xs text-muted">{String(n).padStart(2, "0")}</span>
          <Link href={`/investors/${r.id}`} className="font-semibold tracking-tight hover:underline">{r.firm_name}</Link>
          {pick.basis === "prepare_targeted_outreach" && <Pill tone="info">{ACTION_LABEL.prepare_targeted_outreach}</Pill>}
        </div>
        {l && <p className="mt-1.5 line-clamp-2 text-sm leading-snug">{l.headline}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5"><Chips pick={pick} /><Fresh at={r.last_checked} /></div>
        {r.angle && <div className="mt-2 flex items-start justify-between gap-2"><p className="line-clamp-2 text-xs leading-relaxed text-muted">{r.angle}</p><CopyButton text={r.angle} /></div>}
      </div>
    </div>
  );
}
