import { AiError, createGemini, type AiClient } from "./gemini";
import { createOpenRouter, modelFor } from "./openrouter";

/**
 * The AI client the whole app uses. Routes are tried in order and the first that answers wins:
 *   1. Google Gemini Flash with GEMINI_API_KEY
 *   2. Google Gemini Flash with GEMINI_API_KEY_2 (optional, e.g. a key from another Google project with its own free quota)
 *   3. the same Gemini Flash model through OpenRouter with OPENROUTER_API_KEY (optional)
 * Only the model's availability is bridged: a blocked prompt is never retried elsewhere, and every route asks for the same model, so
 * the product never silently switches to a different one. With a single key configured this behaves exactly like the plain client.
 */
export interface AiUsage {
  /** Calls answered by the backup route since this server instance started. */
  backupServed: number;
  /** Failed attempts per route since this server instance started. */
  failures: Record<string, number>;
  lastBackupAt: string | null;
}
export const aiUsage: AiUsage = { backupServed: 0, failures: {}, lastBackupAt: null };

export interface ChainOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

const COOLDOWN_MS = 60_000; // after a quota error a route is skipped for a minute, so a long run does not wait on it again and again

export function createAi(opts: ChainOptions = {}): AiClient {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m: string) => console.warn(m));
  const google = [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2].map((k) => k?.trim()).filter((k): k is string => Boolean(k));
  const backupKey = env.OPENROUTER_API_KEY?.trim();
  if (google.length === 0 && !backupKey) return createGemini({ fetchImpl: opts.fetchImpl, sleep: opts.sleep }); // reports "no credentials" as before

  const hasMore = google.length + (backupKey ? 1 : 0) > 1;
  const routes: { name: string; client: AiClient; skipUntil: number }[] = google.map((apiKey, i) => ({
    name: i === 0 ? "gemini" : "gemini_2",
    client: createGemini({ apiKey, fetchImpl: opts.fetchImpl, sleep: opts.sleep, maxAttempts: hasMore ? 2 : 3 }),
    skipUntil: 0,
  }));
  if (backupKey) routes.push({ name: "openrouter", client: createOpenRouter({ apiKey: backupKey, model: modelFor(env), fetchImpl: opts.fetchImpl }), skipUntil: 0 });

  return {
    async generateJson(req) {
      let first: AiError | undefined;
      for (const [i, r] of routes.entries()) {
        const isLast = i === routes.length - 1;
        if (r.skipUntil > now() && !isLast) continue;
        try {
          const out = await r.client.generateJson(req);
          if (r.name === "openrouter") {
            aiUsage.backupServed++;
            aiUsage.lastBackupAt = new Date(now()).toISOString();
            log(`[ai] answered by the backup route (${first?.category ?? "primary skipped"})`);
          }
          return out;
        } catch (e) {
          const err = e instanceof AiError ? e : new AiError("unavailable", "AI request failed");
          if (err.category === "blocked") throw err; // the same prompt would be blocked everywhere: say so, do not shop around
          aiUsage.failures[r.name] = (aiUsage.failures[r.name] ?? 0) + 1;
          if (err.category === "rate_limited") r.skipUntil = now() + COOLDOWN_MS;
          first ??= err;
        }
      }
      throw first ?? new AiError("no_credentials", "No AI key is set");
    },
  };
}
