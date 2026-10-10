import Link from "next/link";
import type { ReactNode } from "react";
import { safeHref, type Tone } from "@/lib/format";
import { ACTION_THRESHOLDS } from "@/lib/scoring/score";

const TONE: Record<Tone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  neutral: "bg-neutral-soft text-neutral",
};
const GLYPH: Record<Tone, string> = { good: "●", warn: "▲", bad: "✕", info: "◆", neutral: "○" };

/** Status pill: colour + glyph + text, so it never relies on colour alone. */
export function Pill({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>
      <span aria-hidden className="text-[0.6rem] leading-none">{GLYPH[tone]}</span>
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface ${className}`}>{children}</section>;
}

export function PageTitle({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-sm text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: string; href?: string; tone?: Tone }) {
  const body = (
    <div className="h-full p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${tone ? TONE[tone].split(" ")[1] : ""}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
  return (
    <Card className={href ? "transition-colors hover:border-accent" : ""}>
      {href ? <Link href={href} className="block h-full rounded-xl">{body}</Link> : body}
    </Card>
  );
}

/** 0–100 score with its tier written out. Tiers are the action thresholds (see ACTION_THRESHOLDS). */
export function ScoreBadge({ score, size = "md" }: { score: number | null; size?: "md" | "lg" }) {
  const { reachOutNow, prepareOutreach } = ACTION_THRESHOLDS;
  const tier = score === null ? null : score >= reachOutNow ? "good" : score >= prepareOutreach ? "info" : "neutral";
  const label = score === null ? "Not scored" : score >= reachOutNow ? "High" : score >= prepareOutreach ? "Medium" : "Low";
  const big = size === "lg";
  return (
    <div className="flex flex-col items-center" title="Follow-up score, 0–100">
      <div
        className={`flex items-center justify-center rounded-full font-semibold tabular-nums ${big ? "h-16 w-16 text-2xl" : "h-12 w-12 text-lg"} ${tier ? TONE[tier] : "border border-dashed border-line text-muted"}`}
      >
        {score ?? "–"}
      </div>
      <span className="mt-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

export function ExternalLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  const safe = safeHref(href);
  if (!safe) return <span className="text-muted">{children}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
      {children}
      <span aria-hidden> ↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="border-dashed p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-xl text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}

export function SetupError({ message }: { message: string }) {
  return (
    <Card className="border-bad p-6" >
      <div role="alert">
        <p className="font-semibold text-bad">The dashboard can't load its data</p>
        <p className="mt-1 text-sm">{message}</p>
        <p className="mt-3 text-sm text-muted">
          Check the server's <code className="rounded bg-neutral-soft px-1">DATABASE_URL</code> and that the migration has been applied
          (<code className="rounded bg-neutral-soft px-1">npm run db:migrate</code>). Nothing on this page is placeholder data.
        </p>
      </div>
    </Card>
  );
}

/** Horizontal bar for one score component, e.g. recency 28 / 30. */
export function Bar({ label, points, max, note }: { label: string; points: number; max: number; note: string }) {
  const pct = Math.round((points / max) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium capitalize">{label}</span>
        <span className="tabular-nums text-muted">
          {points} / {max}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-soft" role="img" aria-label={`${label}: ${points} of ${max} points`}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}
