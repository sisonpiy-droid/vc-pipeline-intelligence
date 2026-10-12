/**
 * A brake on the public chat endpoint, which spends free-tier Gemini calls: at most `max` questions per `windowMs` per visitor.
 * ponytail: in memory, so it is per serverless instance and resets on a cold start. Move it into the database if a determined
 * visitor spreads requests over many instances.
 */
const hits = new Map<string, number[]>();

export function allow(key: string, now = Date.now(), max = 15, windowMs = 10 * 60_000): { ok: true } | { ok: false; retryAfterS: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k); // bound the memory
  return { ok: true };
}

export const resetLimits = () => hits.clear();
