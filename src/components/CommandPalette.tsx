"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowElbowDownLeft, ChatCircleDots, Command, MagnifyingGlass } from "@phosphor-icons/react";
import { ACTION_LABEL, ENTITY_LABEL } from "@/lib/format";
import { compareStore, useCompare } from "./compareStore";

interface Inv { id: string; name: string; type: string; score: number | null; action: string | null }
interface Item { key: string; label: string; hint: string; href: string; inv?: Inv; ask?: boolean }

const PAGES: Item[] = [
  { key: "p-home", label: "Priority queue", hint: "Start here", href: "/" },
  { key: "p-brief", label: "Weekly brief", hint: "What changed since the last refresh", href: "/brief" },
  { key: "p-pipeline", label: "Pipeline", hint: "Search and filter every investor", href: "/pipeline" },
  { key: "p-sim", label: "What-if ranking", hint: "Change the weights and watch the ranking move", href: "/simulate" },
  { key: "p-board", label: "Outreach board", hint: "Drag investors through your stages", href: "/board" },
  { key: "p-signals", label: "Signals", hint: "All evidence, with sources", href: "/signals" },
  { key: "p-quiet", label: "Quiet investors", hint: "No signal, failed, or incomplete", href: "/quiet" },
  { key: "p-news", label: "Venture capital news", hint: "What is happening in the market", href: "/news" },
  { key: "p-runs", label: "Runs & audit", hint: "Refresh history, provider health, credits", href: "/runs" },
  { key: "p-compare", label: "Compare investors", hint: "Side by side", href: "/compare" },
  { key: "p-api", label: "API reference", hint: "Routes, auth and limits", href: "/api-docs" },
];

/** Case-insensitive: every query word must appear; names that start with the query rank first. */
export function rank(items: Item[], q: string): Item[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items
    .map((it) => {
      const hay = `${it.label} ${it.hint}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      return { it, s: it.label.toLowerCase().startsWith(words[0]!) ? 0 : it.label.toLowerCase().includes(words[0]!) ? 1 : 2 };
    })
    .filter((x): x is { it: Item; s: number } => x !== null)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.it);
}

/** Ctrl/Cmd+K: jump to any page or investor, or add an investor to the comparison. */
export function CommandPalette({ wide = false }: { wide?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [invs, setInvs] = useState<Inv[] | null>(null);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const picked = useCompare();

  const close = useCallback(() => { setOpen(false); setQ(""); setSel(0); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    if (invs || failed) return;
    fetch("/api/palette").then((r) => (r.ok ? r.json() : Promise.reject())).then((j: { investors: Inv[] }) => setInvs(j.investors)).catch(() => setFailed(true));
  }, [open, invs, failed]);

  const items = useMemo(() => {
    const inv: Item[] = (invs ?? []).map((i) => ({ key: i.id, label: i.name, hint: `${ENTITY_LABEL[i.type] ?? i.type}${i.score !== null ? ` · score ${i.score}` : ""}${i.action ? ` · ${ACTION_LABEL[i.action]}` : ""}`, href: `/investors/${i.id}`, inv: i }));
    const found = rank([...PAGES, ...inv], q).slice(0, 11);
    // The same box is also the assistant: a question goes to the chat. It leads when the text reads like a question, and trails otherwise.
    const text = q.trim();
    const ask: Item = { key: "ask", ask: true, href: "", label: text ? `Ask the assistant: “${text}”` : "Ask the assistant", hint: "Gemini answers from your pipeline data" };
    const questionLike = !text || /\?$/.test(text) || text.split(/\s+/).length >= 3;
    return questionLike ? [ask, ...found] : [...found, ask];
  }, [invs, q]);

  useEffect(() => setSel(0), [q]);
  const go = (it: Item) => {
    const question = q.trim();
    close();
    if (it.ask) window.dispatchEvent(new CustomEvent("vc:ask", { detail: { q: question } }));
    else router.push(it.href);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`press inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-xs text-muted transition-colors hover:border-accent/50 hover:text-ink ${wide ? "w-full py-2" : "py-1.5"}`} aria-label="Search or ask (Ctrl K)">
        <MagnifyingGlass aria-hidden size={13} weight="bold" /> Search or ask
        <kbd className="num ml-auto inline-flex items-center gap-0.5 rounded border border-line px-1 text-[0.65rem]"><Command aria-hidden size={9} weight="bold" />K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-start justify-items-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div role="dialog" aria-modal="true" aria-label="Search" className="card-shadow w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex items-center gap-2 border-b border-line px-4">
              <MagnifyingGlass aria-hidden size={16} weight="bold" className="text-muted" />
              <input
                ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search investors and pages, or ask a question…" autoComplete="off" role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={items[sel] ? `pal-${items[sel]!.key}` : undefined}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                  else if (e.key === "Enter" && items[sel]) { e.preventDefault(); go(items[sel]!); }
                }}
                className="w-full bg-transparent py-3.5 text-sm outline-none"
              />
              <kbd className="num rounded border border-line px-1 text-[0.65rem] text-muted">Esc</kbd>
            </div>
            <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
              {items.map((it, n) => {
                const on = !!it.inv && picked.some((p) => p.id === it.inv!.id);
                return (
                  <li key={it.key} id={`pal-${it.key}`} role="option" aria-selected={n === sel} onMouseEnter={() => setSel(n)} className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${n === sel ? "bg-neutral-soft" : ""}`}>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => go(it)}>
                      <span className="flex items-center gap-2 truncate font-medium">{it.ask && <ChatCircleDots aria-hidden size={14} weight="bold" className="shrink-0 text-accent" />}<span className="truncate">{it.label}</span></span>
                      <span className="block truncate text-xs text-muted">{it.hint}</span>
                    </button>
                    {it.inv && (
                      <button type="button" onClick={() => compareStore.toggle({ id: it.inv!.id, name: it.inv!.name })} aria-pressed={on} className={`press shrink-0 rounded-md border px-2 py-0.5 text-xs ${on ? "border-accent text-good" : "border-line text-muted hover:text-ink"}`}>{on ? "In comparison" : "Compare"}</button>
                    )}
                    {n === sel && !it.inv && <ArrowElbowDownLeft aria-hidden size={14} className="shrink-0 text-muted" />}
                  </li>
                );
              })}
              {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{failed ? "Investor list unavailable right now." : invs ? "No match." : "Loading…"}</li>}
            </ul>
            <p className="border-t border-line px-4 py-2 text-[0.7rem] text-muted">↑ ↓ to move · Enter to open or ask · Esc to close</p>
          </div>
        </div>
      )}
    </>
  );
}
