"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const localDay = () => new Date().toLocaleDateString("en-CA");

interface Action { label: string; status: string; note: string; stamp?: boolean }

/** The one-click outcomes that make sense from each status. Every one records a history line and, for a real exchange, today's date. */
const ACTIONS: Record<string, Action[]> = {
  not_contacted: [{ label: "I sent it another way", status: "contacted", note: "Contacted outside the app", stamp: true }],
  contacted: [
    { label: "They replied", status: "in_conversation", note: "They replied", stamp: true },
    { label: "They passed", status: "passed", note: "They passed", stamp: true },
    { label: "Still waiting", status: "awaiting_response", note: "No reply yet: waiting" },
  ],
  awaiting_response: [
    { label: "They replied", status: "in_conversation", note: "They replied", stamp: true },
    { label: "They passed", status: "passed", note: "They passed", stamp: true },
  ],
  in_conversation: [
    { label: "They committed", status: "committed", note: "They committed", stamp: true },
    { label: "They passed", status: "passed", note: "They passed", stamp: true },
  ],
};

/** Replies arrive in the founder's own inbox, which this application cannot read: the founder reports what happened, in one click. */
export function ReplyLog({ id, status, needPass }: { id: string; status: string; needPass: boolean }) {
  const router = useRouter();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const actions = ACTIONS[status];
  if (!actions) return null;

  async function run(a: Action) {
    setBusy(true);
    setMsg(null);
    const body = { relationship_status: a.status, ...(a.stamp ? { last_contact_date: localDay() } : {}), add_contact: { date: localDay(), channel: "email", note: a.note } };
    const res = await fetch(`/api/investors/${id}/founder`, { method: "POST", headers: { "content-type": "application/json", ...(needPass ? { "x-admin-passcode": pass } : {}) }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (res?.ok) { setMsg({ tone: "good", text: "Saved. The score, the follow-up reminders and the board now use this." }); setPass(""); router.refresh(); }
    else setMsg({ tone: "bad", text: res?.status === 401 ? "Wrong passcode." : res?.status === 429 ? "Too many wrong attempts. Try again later." : "Could not save. Nothing was changed." });
  }

  return (
    <div className="mt-4">
      {needPass && <input type="password" autoComplete="off" aria-label="Admin passcode" placeholder="Admin passcode" value={pass} onChange={(e) => setPass(e.target.value)} className="mb-2 w-44 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm" />}
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a) => (
          <button key={a.label} type="button" disabled={busy || (needPass && !pass)} onClick={() => run(a)} className="press rounded-full border border-line px-3.5 py-1.5 text-sm font-medium transition-colors hover:border-accent/50 disabled:opacity-50">{a.label}</button>
        ))}
      </div>
      {msg && <p role="status" className={`mt-2 text-xs ${msg.tone === "good" ? "text-good" : "text-bad"}`}>{msg.text}</p>}
    </div>
  );
}
