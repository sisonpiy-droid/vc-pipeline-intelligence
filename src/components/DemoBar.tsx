"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The banner shown on every page in demo mode. It says what this is, and offers the two demo-only actions plus the way out.
 * Both actions only ever touch demo rows; the server enforces that, not this component.
 */
export function DemoBar({ needPass }: { needPass: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"reset" | "simulate" | null>(null);
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function act(kind: "reset" | "simulate") {
    setBusy(kind);
    setMsg(null);
    try {
      const res = await fetch(`/api/demo/${kind}`, { method: "POST", headers: needPass ? { "x-admin-passcode": pass } : {} });
      const j = (await res.json().catch(() => ({}))) as { removed?: number; created?: number; investors?: number; changed?: number; message?: string };
      if (res.ok) {
        setMsg(kind === "reset" ? `Demo data reset: ${j.removed ?? 0} demo records removed, ${j.created ?? 0} recreated. Real data was not touched.` : `Simulated refresh done: ${j.investors ?? 0} demo investors re-scored, ${j.changed ?? 0} changed. No searches or AI calls were made.`);
        router.refresh();
      } else setMsg(res.status === 401 ? "Wrong passcode." : j.message ?? `Could not do that (HTTP ${res.status}).`);
    } catch {
      setMsg("Network error: nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  const btn = "press rounded-md border border-current/30 px-2.5 py-1 text-xs font-medium hover:bg-white/30 disabled:opacity-50 dark:hover:bg-white/10";
  return (
    <div role="region" aria-label="Demo mode" className="border-b border-warn/40 bg-warn-soft text-warn">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-[0.8rem] sm:px-6">
        <p className="font-medium"><span className="num mr-2 rounded bg-warn px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wider text-warn-soft">Demo mode</span>Synthetic investors and simulated runs. This is a demo account: nothing here is real investor intelligence.</p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {needPass && <input type="password" aria-label="Admin passcode" placeholder="Admin passcode" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} className="w-32 rounded-md border border-current/30 bg-transparent px-2 py-1 text-xs placeholder:text-current/60" />}
          <button type="button" className={btn} disabled={busy !== null} onClick={() => act("simulate")}>{busy === "simulate" ? "Running…" : "Run simulated refresh"}</button>
          <button type="button" className={btn} disabled={busy !== null} onClick={() => act("reset")}>{busy === "reset" ? "Resetting…" : "Reset demo data"}</button>
          <Link href="/demo/off" prefetch={false} className={btn}>Exit demo mode</Link>
        </div>
        {msg && <p role="status" className="w-full text-xs font-medium">{msg}</p>}
      </div>
    </div>
  );
}
