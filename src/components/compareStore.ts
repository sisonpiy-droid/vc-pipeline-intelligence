"use client";

import { useSyncExternalStore } from "react";

/** The investors picked for comparison (at most 3), kept in this tab's sessionStorage. Nothing about it leaves the browser. */
export interface Picked { id: string; name: string }
export const MAX_COMPARE = 3;

const KEY = "vc.compare";
const EMPTY: Picked[] = [];
let state: Picked[] | null = null;
const subs = new Set<() => void>();

function read(): Picked[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p) => p && typeof p.id === "string" && typeof p.name === "string").slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
}
const snapshot = () => (state ??= read());
function set(next: Picked[]) {
  state = next;
  try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: the selection just lasts until reload */ }
  subs.forEach((f) => f());
}

export const compareStore = {
  toggle(p: Picked): "added" | "removed" | "full" {
    const cur = snapshot();
    if (cur.some((x) => x.id === p.id)) { set(cur.filter((x) => x.id !== p.id)); return "removed"; }
    if (cur.length >= MAX_COMPARE) return "full";
    set([...cur, p]);
    return "added";
  },
  clear: () => set(EMPTY),
};

export function useCompare(): Picked[] {
  return useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, snapshot, () => EMPTY);
}
