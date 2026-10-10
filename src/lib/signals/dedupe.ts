import { nameKey } from "@/lib/normalize";

const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "its", "into", "has", "have", "are", "was", "will", "new", "after", "over", "says", "said"]);

export function headlineTokens(headline: string): Set<string> {
  return new Set(nameKey(headline).split(" ").filter((t) => t.length > 2 && !STOP.has(t)));
}

/** Jaccard overlap of headline words. */
export function headlineSimilarity(a: string, b: string): number {
  const A = headlineTokens(a), B = headlineTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface Dedupable {
  canonical_url: string;
  headline: string;
  published_at: string | null; // YYYY-MM-DD
  /** Higher wins when choosing which copy of an event to keep (e.g. official source > wire copy). */
  authority: number;
}

const DAY = 86_400_000;
const SIMILAR = 0.6;
const WITHIN_DAYS = 7;

export function sameEvent(a: Dedupable, b: Dedupable): boolean {
  if (a.canonical_url === b.canonical_url) return true;
  if (a.published_at && b.published_at && Math.abs(Date.parse(a.published_at) - Date.parse(b.published_at)) > WITHIN_DAYS * DAY) return false;
  return headlineSimilarity(a.headline, b.headline) >= SIMILAR;
}

/**
 * Collapses repeated coverage of one event. Distinct events stay distinct: same investor, different
 * headline/date ⇒ kept separately. Order-independent for the winner (authority, then earliest date).
 */
export function dedupeSignals<T extends Dedupable>(items: T[]): { kept: T[]; duplicates: { item: T; of: T }[] } {
  const ranked = [...items].sort(
    (a, b) => b.authority - a.authority || (a.published_at ?? "9999").localeCompare(b.published_at ?? "9999") || a.canonical_url.localeCompare(b.canonical_url),
  );
  const kept: T[] = [];
  const duplicates: { item: T; of: T }[] = [];
  for (const item of ranked) {
    const original = kept.find((k) => sameEvent(k, item));
    if (original) duplicates.push({ item, of: original });
    else kept.push(item);
  }
  return { kept, duplicates };
}
