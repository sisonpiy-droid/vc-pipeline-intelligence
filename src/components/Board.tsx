"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ACTION_LABEL, ACTION_TONE, ENTITY_LABEL, REL_LABEL } from "@/lib/format";
import { gsap, prefersReducedMotion } from "./motion/gsap";
import { Pill } from "./ui";

export interface BoardCard {
  id: string;
  firm_name: string;
  entity_type: string;
  score: number | null;
  action: string | null;
  status: string;
  last_contact_date: string | null;
  headline: string | null;
  cadence: { label: string; tone: "good" | "warn" | "bad" | "info" | "neutral"; due: boolean } | null;
}

const COLUMNS = ["not_contacted", "contacted", "in_conversation", "awaiting_response", "committed", "passed"] as const;
const HINT: Record<string, string> = {
  not_contacted: "Worth contacting, by score",
  contacted: "First message sent",
  in_conversation: "They are talking to you",
  awaiting_response: "Ball is in their court",
  committed: "Money is coming",
  passed: "Not this round",
};
const CONTACTED_STATES = new Set(["contacted", "in_conversation", "awaiting_response"]);
const FIRST_COLUMN_LIMIT = 14;

type Toast = { tone: "good" | "bad" | "warn"; text: string } | null;

const istDay = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * A kanban of relationship status. Dragging a card changes the founder-owned `relationship_status` through the same
 * audited, validated endpoint as the editor on the investor page: a refresh can never move a card, and this can never
 * touch a score. Every card also has a "Move to" control, so nothing depends on drag and drop.
 */
export function Board({ cards: initial, needPass, hiddenInFirst }: { cards: BoardCard[]; needPass: boolean; hiddenInFirst: number }) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [pass, setPass] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const dragging = useRef<string | null>(null);
  const landed = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setCards(initial), [initial]);
  useLayoutEffect(() => {
    const id = landed.current;
    landed.current = null;
    if (!id || prefersReducedMotion()) return;
    const el = root.current?.querySelector(`[data-card="${id}"]`);
    if (el) gsap.fromTo(el, { scale: 0.94, y: -6 }, { scale: 1, y: 0, duration: 0.5, ease: "back.out(2.2)", clearProps: "transform" });
  });

  async function move(id: string, to: string) {
    const card = cards.find((c) => c.id === id);
    if (!card || card.status === to) return;
    if (needPass && !pass) return setToast({ tone: "warn", text: "Enter the admin passcode above to move cards." });
    const stamp = card.status === "not_contacted" && !card.last_contact_date && CONTACTED_STATES.has(to);
    const prev = cards;
    landed.current = id;
    setCards(cards.map((c) => (c.id === id ? { ...c, status: to, last_contact_date: stamp ? istDay() : c.last_contact_date } : c)));
    try {
      const res = await fetch(`/api/investors/${id}/founder`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(needPass ? { "x-admin-passcode": pass } : {}) },
        body: JSON.stringify({ relationship_status: to, ...(stamp ? { last_contact_date: istDay() } : {}) }),
      });
      if (!res.ok) throw new Error(res.status === 401 ? "Wrong passcode." : res.status === 429 ? "Too many wrong attempts. Try again later." : res.status === 503 ? "Editing is not enabled on this server." : `Could not save (HTTP ${res.status}).`);
      setToast({ tone: "good", text: `${card.firm_name} → ${REL_LABEL[to]}${stamp ? ", last contact set to today (edit it on the investor page)" : ""}.` });
      router.refresh();
    } catch (e) {
      setCards(prev);
      setToast({ tone: "bad", text: `${(e as Error).message || "Network error."} Nothing was changed.` });
    }
  }

  const tone = { good: "text-good", bad: "text-bad", warn: "text-warn" };
  return (
    <div ref={root}>
      {needPass && (
        <label className="mb-4 flex max-w-sm items-center gap-3 text-xs font-medium text-muted">
          Admin passcode
          <input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} className="flex-1 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm text-ink" />
        </label>
      )}
      <p role="status" aria-live="polite" className={`mb-4 min-h-5 text-sm ${toast ? tone[toast.tone] : ""}`}>{toast?.text}</p>
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        {COLUMNS.map((col) => {
          const all = cards.filter((c) => c.status === col);
          const list = col === "not_contacted" ? all.slice(0, FIRST_COLUMN_LIMIT) : all;
          const extra = col === "not_contacted" ? hiddenInFirst + Math.max(0, all.length - list.length) : 0;
          return (
            <section
              key={col}
              aria-label={`${REL_LABEL[col]}, ${all.length} investors`}
              onDragOver={(e) => { e.preventDefault(); setOver(col); }}
              onDragLeave={() => setOver((o) => (o === col ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = dragging.current ?? e.dataTransfer.getData("text/plain"); dragging.current = null; if (id) void move(id, col); }}
              className={`w-72 shrink-0 snap-start rounded-2xl border p-3 transition-colors ${over === col ? "border-accent bg-good-soft/40" : "border-line bg-surface"}`}
            >
              <header className="mb-3 flex items-baseline justify-between px-1">
                <h2 className="text-sm font-semibold">{REL_LABEL[col]}</h2>
                <span className="num text-xs text-muted">{all.length + (col === "not_contacted" ? hiddenInFirst : 0)}</span>
              </header>
              <p className="mb-3 px-1 text-[0.7rem] text-muted">{HINT[col]}</p>
              <ul className="space-y-2.5">
                {list.map((c) => (
                  <li
                    key={c.id}
                    data-card={c.id}
                    draggable
                    onDragStart={(e) => { dragging.current = c.id; e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { dragging.current = null; setOver(null); }}
                    className="cursor-grab rounded-xl border border-line bg-bg p-3 text-sm active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/investors/${c.id}`} className="font-medium leading-snug hover:underline">{c.firm_name}</Link>
                      <span className="num text-lg font-medium leading-none">{c.score ?? "–"}</span>
                    </div>
                    <p className="mt-0.5 text-[0.7rem] text-muted">{ENTITY_LABEL[c.entity_type]}</p>
                    {c.headline && <p className="mt-2 line-clamp-2 text-xs leading-snug text-muted">{c.headline}</p>}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.action && <Pill tone={ACTION_TONE[c.action]}>{ACTION_LABEL[c.action]}</Pill>}
                      {c.cadence && <Pill tone={c.cadence.tone} title="Follow-up cadence, from your last-contact date">{c.cadence.label}</Pill>}
                    </div>
                    <label className="mt-2.5 block">
                      <span className="sr-only">Move {c.firm_name} to</span>
                      <select value={c.status} onChange={(e) => void move(c.id, e.target.value)} className="w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted">
                        {COLUMNS.map((s) => <option key={s} value={s}>{c.status === s ? `In: ${REL_LABEL[s]}` : `Move to ${REL_LABEL[s]}`}</option>)}
                      </select>
                    </label>
                  </li>
                ))}
                {list.length === 0 && <li className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted">Drop a card here</li>}
              </ul>
              {extra > 0 && <Link href="/pipeline?relationship=not_contacted" className="mt-3 block px-1 text-xs font-medium text-accent hover:underline">+{extra} more not yet worth a message →</Link>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
