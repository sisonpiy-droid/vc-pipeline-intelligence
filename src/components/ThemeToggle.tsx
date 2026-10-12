"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "@phosphor-icons/react";
import { THEME_KEY } from "@/lib/theme";

/**
 * Night mode, remembered per browser and starting from the visitor's own OS setting. The sidebar shows a two-way
 * Light / Dark switch; the phone header shows one button that flips between them.
 */
export function ThemeToggle({ wide = false }: { wide?: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"), []);

  function pick(next: "light" | "dark") {
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: the choice lasts until the tab closes */ }
  }

  const night = theme === "dark";
  if (!wide) {
    const Icon = night ? Sun : Moon;
    return (
      <button type="button" onClick={() => pick(night ? "light" : "dark")} aria-pressed={night} aria-label={night ? "Switch to light mode" : "Switch to night mode"} title={night ? "Switch to light mode" : "Switch to night mode"}
        className="press inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-accent/50 hover:text-ink">
        <Icon aria-hidden size={17} weight="bold" />
      </button>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <span className="text-xs font-medium text-muted">Theme</span>
      <div role="group" aria-label="Theme" className="flex gap-0.5 rounded-full border border-line bg-bg p-0.5">
        {([["light", "Light", Sun], ["dark", "Dark", Moon]] as const).map(([value, label, Icon]) => (
          <button key={value} type="button" onClick={() => pick(value)} aria-pressed={theme === value} aria-label={`${label} theme`} title={`${label} theme`}
            className={`press inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors ${theme === value ? "bg-accent text-white dark:text-black" : "text-muted hover:text-ink"}`}>
            <Icon aria-hidden size={13} weight="bold" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
