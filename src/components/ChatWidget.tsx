"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChatCircleDots, Trash, X } from "@phosphor-icons/react";

interface Msg { role: "user" | "assistant"; text: string; links?: { id: string; name: string }[]; summary?: boolean }

const SUGGESTIONS = [
  "Who should I email this week?",
  "Why is the top investor ranked first?",
  "Which investors are quiet, and why?",
  "Who needs a follow-up?",
];

/** A small assistant that answers from the dashboard's own data. It cannot send mail or see private notes. */
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy, open]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setErr(null);
    setBusy(true);
    setText("");
    const history = msgs.slice(-6).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: question }]);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: question, history }) });
      const j = (await res.json().catch(() => ({}))) as { answer?: string; links?: Msg["links"]; source?: string; message?: string };
      if (res.ok && j.answer) setMsgs((m) => [...m, { role: "assistant", text: j.answer!, links: j.links, summary: j.source === "summary" }]);
      else setErr(j.message ?? `Something went wrong (HTTP ${res.status}).`);
    } catch {
      setErr("Network error. Your question was not answered; try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label="Ask about your pipeline" className="press fixed bottom-5 right-5 z-[35] inline-flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-medium text-white shadow-[0_12px_28px_-12px_rgb(15_107_107/0.7)] transition-transform hover:-translate-y-0.5 dark:text-black">
          <ChatCircleDots aria-hidden size={18} weight="bold" /> Ask
        </button>
      )}
      {open && (
        <section role="dialog" aria-label="Ask about your pipeline" className="reveal fixed inset-x-3 bottom-3 z-[35] flex max-h-[min(34rem,calc(100dvh-1.5rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_60px_-20px_rgb(40_30_10/0.45)] sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[24rem]">
          <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Ask about your pipeline</h2>
              <p className="mt-0.5 text-[0.7rem] leading-snug text-muted">Answers come from your data only, written by Gemini Flash. It cannot send mail or see your private notes.</p>
            </div>
            <span className="flex shrink-0 items-center gap-1">
              {msgs.length > 0 && <button type="button" onClick={() => { setMsgs([]); setErr(null); }} aria-label="Clear the conversation" title="Clear the conversation" className="press grid h-7 w-7 place-items-center rounded-lg text-muted hover:text-ink"><Trash aria-hidden size={14} weight="bold" /></button>}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close the assistant" className="press grid h-7 w-7 place-items-center rounded-lg text-muted hover:text-ink"><X aria-hidden size={14} weight="bold" /></button>
            </span>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm" aria-live="polite">
            {msgs.length === 0 && (
              <div>
                <p className="text-muted">Ask in plain words. For example:</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => ask(s)} className="press rounded-full border border-line px-3 py-1.5 text-left text-xs font-medium transition-colors hover:border-accent/50">{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 leading-relaxed ${m.role === "user" ? "bg-accent/10" : "bg-neutral-soft"}`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.summary && <p className="mt-1.5 text-[0.7rem] text-muted">Plain summary: the model was unavailable.</p>}
                  {m.links && m.links.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {m.links.map((l) => <Link key={l.id} href={`/investors/${l.id}`} className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-accent hover:border-accent/50">{l.name}</Link>)}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {busy && <div className="max-w-[92%] rounded-2xl bg-neutral-soft px-3.5 py-3" role="status" aria-label="The assistant is thinking"><span className="flex gap-1"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms]" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms]" /></span></div>}
            {err && <p role="alert" className="text-xs leading-relaxed text-bad">{err}</p>}
            <div ref={end} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); ask(text); }} className="flex items-end gap-2 border-t border-line p-3">
            <label htmlFor="chat-q" className="sr-only">Your question</label>
            <textarea
              id="chat-q" ref={input} rows={1} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Ask about an investor or this week"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); } }}
              className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-line bg-bg px-3 py-2 text-sm"
            />
            <button type="submit" disabled={busy || !text.trim()} aria-label="Send the question" className="press grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-white disabled:opacity-40 dark:text-black">
              <ArrowUp aria-hidden size={16} weight="bold" />
            </button>
          </form>
        </section>
      )}
    </>
  );
}
