import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, CheckCircle, Circle, Info, Warning, XCircle } from "@phosphor-icons/react/dist/ssr";
import { safeHref, type Tone } from "@/lib/format";
import { ACTION_THRESHOLDS } from "@/lib/scoring/score";

const TONE: Record<Tone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  neutral: "bg-neutral-soft text-neutral",
};
const ICON = { good: CheckCircle, warn: Warning, bad: XCircle, info: Info, neutral: Circle } as const;

/** Status pill: tinted fill + icon + text, so meaning never depends on colour alone. */
export function Pill({ tone = "neutral", children, title, href }: { tone?: Tone; children: ReactNode; title?: string; href?: string }) {
  const Icon = ICON[tone];
  const cls = `inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]}`;
  const inner = (
    <>
      <Icon aria-hidden size={12} weight="bold" />
      {children}
    </>
  );
  // With an href the pill is a real link (keyboard-focusable) that filters the list it belongs to.
  return href ? (
    <Link href={href} title={title ? `${title} — click to filter` : "Click to filter"} className={`${cls} press hover:brightness-95 hover:ring-1 hover:ring-current/30`}>
      {inner}
    </Link>
  ) : (
    <span title={title} className={cls}>
      {inner}
    </span>
  );
}

/** Raised surface. Used only where elevation carries meaning (a decision card); lists use rules instead. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card-shadow rounded-2xl border border-line bg-surface ${className}`}>{children}</section>;
}

export function PageTitle({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="num text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted">{children}</p>;
}

/** A borderless figure with a top rule — metrics breathe instead of sitting in boxes. */
export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: string; href?: string; tone?: Tone }) {
  const body = (
    <div className="border-t border-line pt-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`num mt-1 text-3xl font-medium ${tone ? TONE[tone].split(" ")[1] : ""}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-70">{body}</Link>
  ) : (
    body
  );
}

/** Score as a mono numeral over a thin tier-coloured bar (tier written out for non-colour readers). */
export function ScoreBadge({ score, size = "md", index = 0 }: { score: number | null; size?: "md" | "lg"; index?: number }) {
  const { reachOutNow, prepareOutreach } = ACTION_THRESHOLDS;
  const tier = score === null ? null : score >= reachOutNow ? "good" : score >= prepareOutreach ? "info" : "neutral";
  const label = score === null ? "Not scored" : score >= reachOutNow ? "High" : score >= prepareOutreach ? "Medium" : "Low";
  const barColor = tier === "good" ? "bg-good" : tier === "info" ? "bg-info" : "bg-muted/60";
  return (
    <div className={`flex shrink-0 flex-col ${size === "lg" ? "w-20" : "w-14"}`} title="Follow-up score, 0–100">
      <span className={`num font-medium leading-none ${size === "lg" ? "text-5xl" : "text-3xl"} ${tier === "good" ? "text-good" : score === null ? "text-muted" : ""}`}>{score ?? "–"}</span>
      <span className="mt-2 block h-[3px] overflow-hidden rounded-full bg-neutral-soft">
        {score !== null && <span style={{ width: `${score}%`, ["--i" as string]: index }} className={`bar-fill block h-full rounded-full ${barColor}`} />}
      </span>
      <span className="mt-1.5 text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted">{label}</span>
    </div>
  );
}

export function ExternalLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  const safe = safeHref(href);
  if (!safe) return <span className="text-muted">{children}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className="inline-flex items-baseline gap-0.5 text-accent underline decoration-accent/30 underline-offset-[3px] transition-colors hover:decoration-accent">
      {children}
      <ArrowUpRight aria-hidden size={12} weight="bold" className="self-center" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-[60ch] text-sm leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function SetupError({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-2xl border border-bad/40 bg-bad-soft p-6">
      <p className="flex items-center gap-2 font-semibold text-bad">
        <XCircle aria-hidden size={18} weight="bold" /> The dashboard can't load its data
      </p>
      <p className="mt-2 text-sm">{message}</p>
      <p className="mt-3 text-sm text-muted">
        Check the server's <code className="num rounded bg-neutral-soft px-1">DATABASE_URL</code> and that the migration has been applied
        (<code className="num rounded bg-neutral-soft px-1">npm run db:migrate</code>). Nothing on this page is placeholder data.
      </p>
    </div>
  );
}

/** Horizontal bar for one score component, e.g. recency 28 / 30. */
export function Bar({ label, points, max, note, index = 0 }: { label: string; points: number; max: number; note: string; index?: number }) {
  const pct = Math.round((points / max) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium capitalize">{label}</span>
        <span className="num text-muted">
          {points} / {max}
        </span>
      </div>
      <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-neutral-soft" role="img" aria-label={`${label}: ${points} of ${max} points`}>
        <div style={{ width: `${pct}%`, ["--i" as string]: index }} className="bar-fill h-full rounded-full bg-accent" />
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{note}</p>
    </div>
  );
}
