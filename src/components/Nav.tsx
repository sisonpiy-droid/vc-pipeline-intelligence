"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ClockCounterClockwise, Code, Database, Globe, House, Kanban, List, MoonStars, Newspaper, PlayCircle, Pulse, Rows, SlidersHorizontal, Stack, X,
} from "@phosphor-icons/react";

const GROUPS = [
  { title: "Work", links: [
    { href: "/", label: "Priority queue", Icon: House },
    { href: "/pipeline", label: "Pipeline", Icon: Rows },
    { href: "/board", label: "Outreach board", Icon: Kanban },
    { href: "/brief", label: "Weekly brief", Icon: Newspaper },
  ] },
  { title: "Evidence", links: [
    { href: "/signals", label: "Signals", Icon: Pulse },
    { href: "/quiet", label: "Quiet investors", Icon: MoonStars },
    { href: "/simulate", label: "What-if ranking", Icon: SlidersHorizontal },
  ] },
  { title: "Industry", links: [
    { href: "/news", label: "VC news", Icon: Globe },
  ] },
  { title: "More startups", links: [
    { href: "/startups", label: "Startups", Icon: Stack },
    { href: "/database", label: "Investor database", Icon: Database },
  ] },
  { title: "Watch", links: [
    { href: "/video", label: "Demo video", Icon: PlayCircle },
  ] },
  { title: "System", links: [
    { href: "/runs", label: "Runs & audit", Icon: ClockCounterClockwise },
    { href: "/api-docs", label: "API reference", Icon: Code },
  ] },
] as const;

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

function Links({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="space-y-6">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="num px-3 text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted">{g.title}</p>
          <ul className="mt-2 space-y-0.5">
            {g.links.map(({ href, label, Icon }) => {
              const on = isActive(path, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={on ? "page" : undefined}
                    className={`press group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${on ? "bg-accent/10 font-medium text-ink" : "text-muted hover:bg-neutral-soft hover:text-ink"}`}
                  >
                    <span aria-hidden className={`absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent transition-opacity duration-300 ${on ? "opacity-100" : "opacity-0"}`} />
                    <Icon aria-hidden size={17} weight={on ? "fill" : "regular"} className={on ? "text-accent" : ""} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The desktop rail. */
export function SideNav() {
  return <Links />;
}

/** Phone and tablet: a button that opens the same navigation as a slide-over panel. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="press grid h-9 w-9 place-items-center rounded-lg border border-line text-muted hover:text-ink">
        <List aria-hidden size={18} weight="bold" />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-0 z-50">
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" />
          <div className="reveal absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r border-line bg-surface p-5 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <span className="text-sm font-semibold tracking-tight">Menu</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="press grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-ink"><X aria-hidden size={16} weight="bold" /></button>
            </div>
            <Links onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
