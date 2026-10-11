"use client";

import Link from "next/link";
import { Scales, X } from "@phosphor-icons/react";
import { compareStore, useCompare } from "./compareStore";

/** Appears at the bottom of every page once an investor is picked; links to the side-by-side view. */
export function CompareTray() {
  const picked = useCompare();
  if (picked.length === 0) return null;
  return (
    <div role="region" aria-label="Comparison" className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[min(92vw,34rem)] items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
      <Scales aria-hidden size={18} weight="bold" className="shrink-0 text-accent" />
      <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {picked.map((p) => (
          <li key={p.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-neutral-soft px-2.5 py-0.5 text-xs font-medium">
            <span className="truncate">{p.name}</span>
            <button type="button" aria-label={`Remove ${p.name}`} onClick={() => compareStore.toggle(p)} className="rounded-full text-muted hover:text-ink"><X aria-hidden size={11} weight="bold" /></button>
          </li>
        ))}
      </ul>
      {picked.length >= 2 ? (
        <Link href={`/compare?ids=${picked.map((p) => p.id).join(",")}`} className="press shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white dark:text-black">Compare {picked.length}</Link>
      ) : (
        <span className="shrink-0 text-xs text-muted">Pick one more</span>
      )}
      <button type="button" onClick={compareStore.clear} className="shrink-0 text-xs text-muted hover:text-ink">Clear</button>
    </div>
  );
}
