"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilSimple } from "@phosphor-icons/react";

const STATUSES: [string, string][] = [
  ["not_contacted", "Not contacted"],
  ["contacted", "Contacted"],
  ["in_conversation", "In conversation"],
  ["awaiting_response", "Awaiting response"],
  ["passed", "Passed"],
  ["committed", "Committed"],
];

type Msg = { tone: "good" | "bad" | "warn"; text: string };

/** Edit the founder-owned fields. The passcode is sent as a header and kept only in component state. */
export function FounderEdit({ id, status, lastContact, notes, needPass = true, demo = false }: { id: string; status: string; lastContact: string | null; notes: string | null; needPass?: boolean; demo?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [st, setSt] = useState(status);
  const [last, setLast] = useState(lastContact ?? "");
  const [text, setText] = useState(notes ?? "");
  const [cDate, setCDate] = useState("");
  const [cChannel, setCChannel] = useState("");
  const [cNote, setCNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    // Send only what actually changed, so an edit can never silently overwrite a field the founder did not touch.
    const body: Record<string, unknown> = {};
    if (st !== status) body.relationship_status = st;
    if ((last || null) !== lastContact) body.last_contact_date = last || null;
    if (text !== (notes ?? "")) body.personal_notes = text === "" ? null : text;
    if (cNote.trim()) body.add_contact = { date: cDate || null, channel: cChannel || undefined, note: cNote.trim() };
    if (Object.keys(body).length === 0) {
      setBusy(false);
      return setMsg({ tone: "warn", text: "Nothing changed." });
    }
    try {
      const res = await fetch(`/api/investors/${id}/founder`, { method: "POST", headers: { ...(needPass ? { "x-admin-passcode": pass } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) {
        setMsg({ tone: "good", text: "Saved. The next refresh will use this (for example, “awaiting response” makes it wait rather than chase)." });
        setPass("");
        setCNote("");
        router.refresh();
      } else if (res.status === 401) setMsg({ tone: "bad", text: "Wrong passcode." });
      else if (res.status === 429) setMsg({ tone: "bad", text: "Too many wrong attempts. Try again later." });
      else if (res.status === 503) setMsg({ tone: "warn", text: j.message ?? "Editing is not enabled on this server." });
      else setMsg({ tone: "bad", text: j.message ?? `Could not save (HTTP ${res.status}).` });
    } catch {
      setMsg({ tone: "bad", text: "Network error — nothing was saved." });
    } finally {
      setBusy(false);
    }
  }

  const color = { good: "text-good", bad: "text-bad", warn: "text-warn" };
  const field = "mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm";
  return (
    <div className="mt-4">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent">
        <PencilSimple aria-hidden size={14} weight="bold" /> {open ? "Close editor" : "Edit relationship"}
      </button>
      {open && (
        <form onSubmit={save} className="reveal mt-3 space-y-3 rounded-2xl border border-line bg-surface p-4">
          <label className="block text-xs font-medium text-muted">Status
            <select value={st} onChange={(e) => setSt(e.target.value)} className={`${field} text-ink`}>
              {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-muted">Last contact
            <input type="date" value={last} onChange={(e) => setLast(e.target.value)} className={`${field} text-ink`} />
          </label>
          <fieldset className="rounded-xl border border-dashed border-line p-3">
            <legend className="px-1 text-xs font-medium text-muted">Add a contact-history entry</legend>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" aria-label="Entry date" value={cDate} onChange={(e) => setCDate(e.target.value)} className={`${field} mt-0 text-ink`} />
              <input aria-label="Channel" placeholder={demo ? "This is a demo account" : "email, call…"} maxLength={40} value={cChannel} onChange={(e) => setCChannel(e.target.value)} className={`${field} mt-0 text-ink`} />
            </div>
            <textarea aria-label="What happened" placeholder={demo ? "This is a demo account" : "What happened?"} maxLength={500} rows={2} value={cNote} onChange={(e) => setCNote(e.target.value)} className={`${field} text-ink`} />
          </fieldset>
          <label className="block text-xs font-medium text-muted">Personal notes
            <textarea rows={4} maxLength={5000} placeholder={demo ? "This is a demo account" : undefined} value={text} onChange={(e) => setText(e.target.value)} className={`${field} text-ink`} />
          </label>
          {needPass && (
            <label className="block text-xs font-medium text-muted">Admin passcode
              <input type="password" autoComplete="off" required value={pass} onChange={(e) => setPass(e.target.value)} className={`${field} text-ink`} />
            </label>
          )}
          <button disabled={busy || (needPass && !pass)} className="press w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-black">{busy ? "Saving…" : "Save"}</button>
          {msg && <p role="status" className={`text-sm leading-relaxed ${color[msg.tone]}`}>{msg.text}</p>}
          <p className="text-xs leading-relaxed text-muted">Only these four fields can be changed here. Nothing a refresh finds can overwrite them, and these edits can never change a score.</p>
        </form>
      )}
    </div>
  );
}
