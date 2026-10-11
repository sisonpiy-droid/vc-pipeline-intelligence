"use client";

import { WarningOctagon } from "@phosphor-icons/react";

/** Boundary for anything that throws while rendering a page. Shows a retry, never a stack trace. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-bad/40 bg-bad-soft p-8">
      <p className="flex items-center gap-2 text-lg font-semibold text-bad">
        <WarningOctagon aria-hidden size={22} weight="bold" /> Something went wrong loading this page
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        The data could not be read just now. Nothing was changed, and your notes and contact history are untouched.
      </p>
      <button onClick={reset} className="press mt-5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-bg hover:opacity-90">
        Try again
      </button>
    </div>
  );
}
