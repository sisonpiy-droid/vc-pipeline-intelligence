/**
 * Refresh schedule: Mondays and Thursdays at 04:00 UTC (09:30 IST) — twice weekly, spaced 3 and 4 days apart.
 * vercel.json holds the same expression (a test keeps the two in step). Vercel Hobby allows one run per
 * day at most, with up to ~59 minutes of jitter, so "about 04:00–05:00 UTC" is the honest statement.
 */
export const CRON_SCHEDULE = "0 4 * * 1,4";
const DAYS = [1, 4]; // Monday, Thursday (UTC)
const HOUR = 4;

export function nextScheduledRun(now: Date): Date {
  for (let d = 0; d <= 8; d++) {
    const c = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, HOUR, 0, 0));
    if (DAYS.includes(c.getUTCDay()) && c.getTime() > now.getTime()) return c;
  }
  throw new Error("unreachable: a Monday or Thursday always exists within 8 days");
}
