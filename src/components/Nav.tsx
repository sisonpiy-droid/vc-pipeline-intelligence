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
    <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto pb-1 text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition-colors ${active ? "bg-accent text-white dark:text-black" : "text-muted hover:bg-neutral-soft hover:text-ink"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
