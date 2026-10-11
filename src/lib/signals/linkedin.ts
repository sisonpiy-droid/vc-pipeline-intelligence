import { isoDay } from "./window";

/**
 * LinkedIn post URLs carry the post's numeric ID (…-activity-7394731971735674882-xxxx, or urn:li:activity:…).
 * Those IDs are time-ordered: the top bits are a millisecond timestamp (id >> 22). That gives a real, deterministic
 * publication date from the URL itself — not a guess — for posts the search provider leaves undated.
 * Returns YYYY-MM-DD, or null if the URL has no such ID or the decoded time is implausible.
 */
export function linkedinPostDate(url: string, now = new Date()): string | null {
  const m = /(?:activity|ugcPost|share)[-:](\d{16,20})/.exec(url);
  if (!m) return null;
  let ms: number;
  try {
    ms = Number(BigInt(m[1]!) >> 22n);
  } catch {
    return null;
  }
  // LinkedIn launched in 2003; reject anything before 2010 or in the future (a wrong decode must not become a date).
  if (!Number.isFinite(ms) || ms < Date.UTC(2010, 0, 1) || ms > now.getTime() + 86_400_000) return null;
  return isoDay(new Date(ms));
}
