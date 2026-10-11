"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";

type Msg = { tone: "good" | "bad" | "warn"; text: string };

/** Manual refresh. The passcode is sent as a header and kept only in component state. */
export function RefreshButton({ label = "Refresh now" }: { label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkedin, setLinkedin] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST", headers: { "x-admin-passcode": pass, "content-type": "application/json" }, body: JSON.stringify({ linkedin }) });
      const body = (await res.json().catch(() => ({}))) as { state?: string; retry_after_s?: number; missing?: string[]; message?: string };
      if (res.status === 202) setMsg({ tone: "good", text: "Refresh started. Progress updates in the status bar." });
      else if (res.status === 200 && body.state === "nothing_due") setMsg({ tone: "good", text: "Nothing to search: every investor was checked recently or is quiet. No credits used." });
      else if (res.status === 200) setMsg({ tone: "warn", text: "A refresh is already running; showing its progress." });
      else if (res.status === 401) setMsg({ tone: "bad", text: "Wrong passcode." });
      else if (res.status === 429 && body.retry_after_s) setMsg({ tone: "warn", text: `A manual refresh ran recently (each one uses search and AI credits). Try again in ${Math.ceil(body.retry_after_s / 60)} min.` });
      else if (res.status === 429) setMsg({ tone: "bad", text: "Too many wrong attempts. Try again later." });
      else if (res.status === 503) setMsg({ tone: "warn", text: body.message ?? "Manual refresh is not enabled on this server." });
      else if (res.status === 500 && body.missing) setMsg({ tone: "bad", text: `Server is missing configuration: ${body.missing.join(", ")}.` });
      else setMsg({ tone: "bad", text: `Could not start a refresh (HTTP ${res.status}).` });
      if (res.ok) {
        setPass("");
        router.refresh();
      }
    } catch {
      setMsg({ tone: "bad", text: "Network error — could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  const color = { good: "text-good", bad: "text-bad", warn: "text-warn" };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="press inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-bg hover:opacity-90"
      >
        <ArrowsClockwise aria-hidden size={14} weight="bold" className={busy ? "animate-spin" : ""} />
        {label}
      </button>
      {open && (
        <form onSubmit={submit} className="reveal absolute left-0 z-40 mt-2 w-72 rounded-2xl border border-line bg-surface p-4 shadow-[0_24px_48px_-24px_rgb(0_0_0/0.35)] sm:left-auto sm:right-0">
          <label htmlFor="pass" className="block text-sm font-medium">Admin passcode</label>
          <input
            id="pass"
            type="password"
            autoComplete="off"
            required
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            className="mt-2 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
          />
          <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted">
            <input type="checkbox" checked={linkedin} onChange={(e) => setLinkedin(e.target.checked)} className="mt-0.5" />
            <span>Also search LinkedIn <span className="text-warn">(uses about twice the search credits)</span></span>
          </label>
          <p className="mt-2 text-xs leading-relaxed text-muted">Searches only investors that are due: not checked in the last 36 hours, and quiet ones about weekly. Limited to one manual run every 10 minutes and to the monthly credit budget.</p>
          <button disabled={busy || !pass} className="press mt-3 w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-black">
            {busy ? "Starting…" : "Start refresh"}
          </button>
          {msg && <p role="status" className={`mt-3 text-sm leading-relaxed ${color[msg.tone]}`}>{msg.text}</p>}
        </form>
      )}
    </div>
  );
}
