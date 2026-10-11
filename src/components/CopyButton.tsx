"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard unavailable: leave the text selectable */
        }
      }}
      className="press inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:text-ink"
      aria-live="polite"
    >
      {done ? <Check aria-hidden size={12} weight="bold" /> : <Copy aria-hidden size={12} weight="bold" />}
      {done ? "Copied" : label}
    </button>
  );
}
