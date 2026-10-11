"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Priority queue" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/signals", label: "Signals" },
  { href: "/quiet", label: "Quiet investors" },
  { href: "/runs", label: "Runs & audit" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`press relative whitespace-nowrap px-3 pb-3 pt-1.5 font-medium transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            {l.label}
            <span aria-hidden className={`absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-accent transition-opacity duration-300 ${active ? "opacity-100" : "opacity-0"}`} />
          </Link>
        );
      })}
    </nav>
  );
}
