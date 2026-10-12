"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowRight, CaretLeft, CaretRight } from "@phosphor-icons/react";

export interface Story {
  key: string;
  tone: "teal" | "amber" | "rose" | "slate" | "sand";
  kicker: string;
  big: string;
  title: string;
  sub: string;
  href: string;
}

/** "Your week in 30 seconds": the week as a few swipeable cards. Each is one fact with a link to where it lives. */
export function StoryCards({ stories }: { stories: Story[] }) {
  const row = useRef<HTMLDivElement>(null);
  const by = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * Math.max(240, (row.current?.clientWidth ?? 600) * 0.7), behavior: "smooth" });
  if (stories.length === 0) return null;
  return (
    <section aria-labelledby="stories-h" className="mt-12">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 id="stories-h" className="text-xl font-semibold">Your week in 30 seconds</h2>
          <p className="mt-0.5 text-xs text-muted">Swipe through, or use the arrows.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => by(-1)} aria-label="Previous cards" className="press grid h-9 w-9 place-items-center rounded-full border border-line text-muted hover:text-ink"><CaretLeft aria-hidden size={14} weight="bold" /></button>
          <button type="button" onClick={() => by(1)} aria-label="Next cards" className="press grid h-9 w-9 place-items-center rounded-full border border-line text-muted hover:text-ink"><CaretRight aria-hidden size={14} weight="bold" /></button>
        </div>
      </div>
      <div ref={row} className="story-scroller -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {stories.map((s) => (
          <Link key={s.key} href={s.href} className={`story-${s.tone} group relative flex min-h-[15rem] w-[15.5rem] shrink-0 flex-col justify-between overflow-hidden rounded-3xl p-5 text-white shadow-[0_18px_30px_-20px_rgb(40_30_10/0.6)] transition-transform duration-300 hover:-translate-y-1`}>
            <span aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
            <span aria-hidden className="pointer-events-none absolute -bottom-10 -left-6 h-28 w-28 rounded-full bg-white/10" />
            <span className="relative text-[0.7rem] font-medium uppercase tracking-[0.14em] text-white/85">{s.kicker}</span>
            <span className="relative">
              <span className="block text-5xl font-bold leading-none">{s.big}</span>
              <span className="mt-3 block text-[0.95rem] font-semibold leading-snug">{s.title}</span>
              <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-white/85">{s.sub}</span>
            </span>
            <span className="relative mt-3 inline-flex items-center gap-1 text-xs font-medium text-white">Open <ArrowRight aria-hidden size={12} weight="bold" className="transition-transform duration-300 group-hover:translate-x-1" /></span>
          </Link>
        ))}
      </div>
    </section>
  );
}
