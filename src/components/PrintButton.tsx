"use client";

import { Printer } from "@phosphor-icons/react";

export function PrintButton() {
  return (
    <button onClick={() => {
      // Closed rows would print closed: open them all for the printout, then put them back.
      const closed = [...document.querySelectorAll<HTMLDetailsElement>("main details:not([open])")];
      closed.forEach((d) => (d.open = true));
      window.print();
      closed.forEach((d) => (d.open = false));
    }} className="press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent print:hidden">
      <Printer aria-hidden size={14} weight="bold" /> Print or save as PDF
    </button>
  );
}
