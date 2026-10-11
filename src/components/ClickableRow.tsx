"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

/**
 * A whole table row (or list item) that opens an investor when clicked anywhere on it, while links, buttons and form controls
 * inside it keep doing their own thing. The investor's name stays a real link, so keyboard and screen-reader users, and
 * "open in new tab", behave exactly as before; the row click is an extra convenience, not the only way in.
 */
const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role=button]";

export function ClickableRow({ as: Tag, href, className = "", children }: { as: "tr" | "li"; href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  const open = (e: MouseEvent | KeyboardEvent) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return; // a control inside the row was used
    if (window.getSelection()?.toString()) return; // the user is selecting text, not clicking
    if ("metaKey" in e && (e.metaKey || e.ctrlKey)) window.open(href, "_blank", "noopener");
    else router.push(href);
  };
  return (
    <Tag onClick={open} className={`cursor-pointer ${className}`} data-row-href={href}>
      {children}
    </Tag>
  );
}
