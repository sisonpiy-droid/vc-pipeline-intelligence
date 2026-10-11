"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";

/**
 * Search-as-you-type for the pipeline. It is still a normal <input name="q"> inside the filter form, so it works
 * without JavaScript; with JavaScript it updates the URL (keeping every other filter) after a short pause.
 * Press "/" anywhere to focus it.
 */
export function LiveSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (value.trim()) params.set("q", value.trim());
      else params.delete("q");
      router.replace(`/pipeline${params.size ? `?${params}` : ""}`, { scroll: false });
    }, 320);
    return () => clearTimeout(t);
  }, [value, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "") && !t?.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <label className="col-span-2 block text-xs font-medium text-muted md:col-span-2">
      Search <kbd className="num ml-1 rounded border border-line px-1 text-[0.65rem]">/</kbd>
      <span className="relative mt-1 block">
        <MagnifyingGlass aria-hidden size={14} weight="bold" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          ref={input}
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Firm or person"
          autoComplete="off"
          className="w-full rounded-md border border-line bg-bg py-1.5 pl-8 pr-2 text-sm text-ink"
        />
      </span>
    </label>
  );
}
