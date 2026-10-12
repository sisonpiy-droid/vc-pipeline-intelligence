"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Envelope } from "@phosphor-icons/react";
import { CopyButton } from "./CopyButton";
import { Linkified } from "./Linkified";

type Msg = { tone: "good" | "warn" | "bad"; text: string; undo?: boolean };

const localDay = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the founder's own time zone

async function edit(id: string, body: unknown) {
  const res = await fetch(`/api/investors/${id}/founder`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return res?.status ?? 0;
}

/**
 * The mail buttons. They open the founder's own mail app or Gmail with the whole email filled in (this application never sends it).
 * Opening a draft for an investor who has not been contacted also records that, on the founder-owned side: status Contacted,
 * last-contact date today, and a history line. It is one click to undo, because opening a draft is not proof that it was sent.
 */
export function MailActions({ id, body, mailto, gmail, status, tracked }: {
  id: string; body: string; mailto: string; gmail: string; status: string; tracked: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  async function track() {
    if (status !== "not_contacted") return;
    if (!tracked) {
      setMsg({ tone: "warn", text: "Not tracked: marking an investor as contacted needs the admin passcode. Do it on the investor page." });
      return;
    }
    const code = await edit(id, { relationship_status: "contacted", last_contact_date: localDay(), add_contact: { date: localDay(), channel: "email", note: "Opened an introduction email in my mail app" } });
    if (code === 200) { setMsg({ tone: "good", text: "Moved to Contacted. Replies arrive in your own inbox: log the outcome on the investor page.", undo: true }); router.refresh(); }
    else setMsg({ tone: "bad", text: "The mail opened, but marking it as contacted failed. You can set it on the investor page." });
  }

  async function undo() {
    setBusy(true);
    const code = await edit(id, { relationship_status: "not_contacted", last_contact_date: null, add_contact: { date: localDay(), channel: "email", note: "Undone: the email was not sent" } });
    setBusy(false);
    if (code === 200) { setMsg({ tone: "warn", text: "Put back to Not contacted." }); router.refresh(); }
    else setMsg({ tone: "bad", text: "Could not undo. Change it on the investor page." });
  }

  const chip = "press inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-accent/50 hover:text-ink";
  const color = { good: "text-good", warn: "text-warn", bad: "text-bad" };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" title="Opens your own mail app with this draft. This application never sends email.">
      <a href={mailto} onClick={track} className={chip}><Envelope aria-hidden size={12} weight="bold" /> Send mail</a>
      <a href={gmail} target="_blank" rel="noopener noreferrer" onClick={track} className={chip}>Gmail<span className="sr-only"> (opens in a new tab)</span></a>
      <button type="button" onClick={() => setPreview((p) => !p)} aria-expanded={preview} className={chip}>{preview ? "Hide email" : "Preview email"}</button>
      <CopyButton text={body} />
      {preview && <pre className="basis-full whitespace-pre-wrap rounded-lg border border-line bg-bg px-3 py-2.5 font-sans text-xs font-normal leading-relaxed text-ink/90"><Linkified text={body} /></pre>}
      {msg && (
        <span role="status" className={`basis-full text-xs leading-relaxed ${color[msg.tone]}`}>
          {msg.text}{" "}
          {msg.undo && <button type="button" onClick={undo} disabled={busy} className="font-medium underline underline-offset-2 disabled:opacity-50">Undo</button>}
        </span>
      )}
    </span>
  );
}
