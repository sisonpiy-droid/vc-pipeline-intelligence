"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Msg = { tone: "good" | "bad" | "warn"; text: string };

/** Manual refresh. The passcode is sent as a header and kept only in component state. */
export function RefreshButton({ label = "Refresh now" }: { label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST", headers: { "x-admin-passcode": pass } });
      const body = (await res.json().catch(() => ({}))) as { state?: string; retry_after_s?: number; missing?: string[]; message?: string };
      if (res.status === 202) setMsg({ tone: "good", text: "Refresh started. Progress updates below." });
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
        className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent"
      >
        {label}
      </button>
      {open && (
        <form onSubmit={submit} className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-line bg-surface p-4 shadow-lg">
          <label htmlFor="pass" className="block text-sm font-medium">Admin passcode</label>
          <input
            id="pass"
            type="password"
            autoComplete="off"
            required
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
          />
          <p className="mt-2 text-xs text-muted">Starts a full refresh of every tracked investor. It uses search and Gemini credits, so it is limited to one manual run every 10 minutes.</p>
          <button disabled={busy || !pass} className="mt-3 w-full rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:text-black">
            {busy ? "Starting…" : "Start refresh"}
          </button>
          {msg && <p role="status" className={`mt-2 text-sm ${color[msg.tone]}`}>{msg.text}</p>}
        </form>
      )}
    </div>
  );
}
