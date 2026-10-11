"use client";

import { useState } from "react";
import { Scales } from "@phosphor-icons/react";
import { compareStore, MAX_COMPARE, useCompare } from "./compareStore";

/** Adds/removes one investor from the comparison tray (max 3). */
export function CompareToggle({ id, name, compact = false }: { id: string; name: string; compact?: boolean }) {
  const picked = useCompare();
  const on = picked.some((p) => p.id === id);
  const [full, setFull] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => { const r = compareStore.toggle({ id, name }); setFull(r === "full"); if (r === "full") setTimeout(() => setFull(false), 2200); }}
      title={on ? "Remove from comparison" : `Compare up to ${MAX_COMPARE} investors side by side`}
      className={`press inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${on ? "border-accent bg-good-soft text-good" : "border-line text-muted hover:text-ink"}`}
    >
      <Scales aria-hidden size={13} weight="bold" />
      {full ? `Max ${MAX_COMPARE}` : compact ? (on ? "Added" : "Compare") : on ? "In comparison" : "Compare"}
    </button>
  );
}
