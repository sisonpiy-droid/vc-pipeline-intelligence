"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "@phosphor-icons/react";
import { THEME_KEY } from "@/lib/theme";

/** Night mode: one button, remembered per browser, starting from the visitor's own OS setting. */
export function ThemeToggle({ wide = false }: { wide?: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"), []);

  function flip() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: the choice lasts until the tab closes */ }
  }

  const night = theme === "dark";
  const Icon = night ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={night}
      aria-label={night ? "Switch to light mode" : "Switch to night mode"}
      title={night ? "Switch to light mode" : "Switch to night mode"}
      className={`press inline-flex items-center justify-center gap-2 rounded-lg border border-line text-xs font-medium text-muted transition-colors hover:border-accent/50 hover:text-ink ${wide ? "w-full px-3 py-2" : "h-9 w-9"}`}
    >
      <Icon aria-hidden size={wide ? 14 : 17} weight="bold" />
      {wide && (night ? "Light mode" : "Night mode")}
    </button>
  );
}
