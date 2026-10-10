import { getDb, type Db } from "@/lib/db";
import { isoDay } from "@/lib/signals/window";

export const today = () => isoDay(new Date());

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

/** Runs a page's queries; turns any failure into a message that is safe to show (no connection details). */
export async function load<T>(fn: (db: Db) => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fn(getDb()) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[page load failed]", msg.slice(0, 300)); // server log only
    if (/DATABASE_URL is not set/.test(msg)) return { ok: false, error: msg };
    if (/relation .* does not exist/i.test(msg)) return { ok: false, error: "The database schema has not been created yet." };
    return { ok: false, error: "The database could not be reached." };
  }
}

type Params = Record<string, string | string[] | undefined>;
export const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v) || undefined;
export const pick = (sp: Params, keys: string[]) => Object.fromEntries(keys.map((k) => [k, first(sp[k])]));
