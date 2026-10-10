/** The research window. A signal only counts if its own date falls inside it. */
export const WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

/** UTC calendar date as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** First day (inclusive) of the window ending at `now`. */
export function windowStart(now: Date, days = WINDOW_DAYS): string {
  return isoDay(new Date(now.getTime() - days * DAY_MS));
}

/** Whole days between an ISO date and `now` (UTC calendar days). */
export function ageInDays(isoDate: string, now: Date): number {
  return Math.round((Date.parse(isoDay(now)) - Date.parse(isoDate)) / DAY_MS);
}

/**
 * Parse a date found on a web page into YYYY-MM-DD, or null. Strict on purpose: a date we cannot
 * parse unambiguously is "unknown", never a guess. Accepts ISO-8601 (with or without time/zone)
 * and "12 October 2026" / "Oct 12, 2026". Rejects impossible dates like 2026-02-31.
 */
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(s);
  let y: number, m: number, d: number;
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const t = Date.parse(s);
    if (Number.isNaN(t) || !/[a-z]{3,}/i.test(s)) return null; // numeric-only formats are ambiguous (01/02/2026)
    const dt = new Date(t);
    // A string that names its zone ("... GMT", "+05:30") is an instant: read its calendar day in UTC so the
    // result does not depend on the server's time zone. A bare "12 October 2026" is a calendar day already.
    const zoned = /(GMT|UTC|Z|[+-]\d{2}:?\d{2})\s*$/i.test(s);
    [y, m, d] = zoned ? [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()] : [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];
  }
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return probe.toISOString().slice(0, 10);
}

export type WindowCheck =
  | { ok: true; ageDays: number }
  | { ok: false; reason: "missing_date" | "out_of_window" | "future_date" };

/** Is `published` (YYYY-MM-DD) inside [now - 30d, now]? One day of slack for time zones on "future". */
export function checkWindow(published: string | null, now: Date, days = WINDOW_DAYS): WindowCheck {
  if (!published) return { ok: false, reason: "missing_date" };
  const age = ageInDays(published, now);
  if (age < -1) return { ok: false, reason: "future_date" };
  if (age > days) return { ok: false, reason: "out_of_window" };
  return { ok: true, ageDays: Math.max(0, age) };
}
