"use client";

import { Printer } from "@phosphor-icons/react";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent print:hidden">
      <Printer aria-hidden size={14} weight="bold" /> Print or save as PDF
    </button>
  );
}
