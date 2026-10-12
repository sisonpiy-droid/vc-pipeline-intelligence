"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, failure, PassField, TONE, type Msg } from "./startupApi";

const STAGES: [string, string][] = [["pre_seed", "Pre-seed"], ["seed", "Seed"], ["series_a", "Series A"], ["series_b_plus", "Series B or later"]];
const FIELD = "mt-2 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm";

/** Add a startup. Gemini drafts its rubric while this waits (a few seconds); no search runs and no search credit is used. */
export function StartupForm({ needPass }: { needPass: boolean }) {
  const router = useRouter();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setMsg(null);
    const { status, data } = await callApi("/api/startups", "POST", Object.fromEntries([...f.entries()].filter(([k]) => k !== "pass")), pass);
    if (status === 201 && typeof data.slug === "string") return router.push(`/startups/${data.slug}`);
    setMsg(failure(status, data));
    setBusy(false);
  }

  return (
    <form method="post" action="/api/startups" onSubmit={submit} className="max-w-2xl space-y-5">
      <div>
        <label htmlFor="name" className="block text-sm font-medium">Startup name</label>
        <input id="name" name="name" required minLength={2} maxLength={80} className={FIELD} placeholder="e.g. Ledgerly" />
      </div>
      <div>
        <label htmlFor="pitch" className="block text-sm font-medium">What it does</label>
        <textarea id="pitch" name="pitch" required minLength={10} maxLength={400} rows={3} className={FIELD} placeholder="One or two sentences: who it is for and what problem it solves." />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="sector" className="block text-sm font-medium">Sector</label>
          <input id="sector" name="sector" required minLength={3} maxLength={120} className={FIELD} placeholder="e.g. B2B payments infrastructure" />
        </div>
        <div>
          <label htmlFor="stage" className="block text-sm font-medium">Stage being raised</label>
          <select id="stage" name="stage" defaultValue="seed" className={FIELD}>
            {STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="geography" className="block text-sm font-medium">Geography</label>
          <input id="geography" name="geography" maxLength={80} defaultValue="India" className={FIELD} />
          <p className="mt-1 text-xs text-muted">Where you operate. Write “Global” if investors anywhere fit.</p>
        </div>
        <div>
          <label htmlFor="round_size" className="block text-sm font-medium">Round size <span className="font-normal text-muted">(optional)</span></label>
          <input id="round_size" name="round_size" maxLength={60} className={FIELD} placeholder="e.g. $1.5M" />
        </div>
      </div>
      <div>
        <label htmlFor="ask" className="block text-sm font-medium">What you want from investors <span className="font-normal text-muted">(optional)</span></label>
        <textarea id="ask" name="ask" maxLength={300} rows={2} className={FIELD} placeholder="e.g. Operators who have scaled B2B payments products in India." />
      </div>
      {needPass && <PassField pass={pass} setPass={setPass} />}
      <div className="flex flex-wrap items-center gap-4">
        <button disabled={busy || (needPass && !pass)} className="press rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:text-black">
          {busy ? "Gemini is writing the rubric…" : "Create startup and its rubric"}
        </button>
        <p className="text-xs text-muted">Takes a few seconds. No search runs and no search credits are used.</p>
      </div>
      {msg && <p role="status" className={`text-sm leading-relaxed ${TONE[msg.tone]}`}>{msg.text}</p>}
    </form>
  );
}
