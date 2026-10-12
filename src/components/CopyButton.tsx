"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import { toHtml } from "@/lib/linkify";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          // With a web address in it, also copy a formatted version, so pasting into Gmail or Outlook gives a real link.
          if (/https?:\/\//.test(text) && typeof ClipboardItem !== "undefined") {
            await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([toHtml(text)], { type: "text/html" }) })]);
          } else await navigator.clipboard.writeText(text);
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
