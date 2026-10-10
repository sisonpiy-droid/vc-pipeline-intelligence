/**
 * Gemini Flash adapter (REST, no SDK). This is the ONLY model the application talks to — there is
 * no fallback provider by design: if Gemini is unavailable the caller gets a typed AiError and the
 * run reports it, rather than silently producing output from a different model.
 */
export type AiErrorCategory = "no_credentials" | "rate_limited" | "unavailable" | "timeout" | "blocked" | "invalid_output" | "bad_request";

export class AiError extends Error {
  constructor(public category: AiErrorCategory, message: string, public status?: number) {
    super(message);
    this.name = "AiError";
  }
}

export interface AiRequest {
  system: string;
  prompt: string;
  responseSchema: object;
}

/** What the rest of the app depends on — easy to replace with a test double. */
export interface AiClient {
  /** Returns the model's JSON output, parsed. Throws AiError. Never returns free text. */
  generateJson(req: AiRequest): Promise<unknown>;
}

export interface GeminiOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_MODEL = "gemini-3.6-flash";

export function createGemini(opts: GeminiOptions = {}): AiClient {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxAttempts = opts.maxAttempts ?? 3;

  return {
    async generateJson(req) {
      const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
      if (!apiKey) throw new AiError("no_credentials", "GEMINI_API_KEY is not set");
      const model = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
      const url = `${BASE}/${encodeURIComponent(model)}:generateContent`;
      // No maxOutputTokens: on Gemini 3.x thinking tokens count against it and can starve the reply
      // (learned the hard way in the Presence app). The JSON schema keeps the output small anyway.
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: req.responseSchema, temperature: 0.1 },
      });

      let last: AiError | undefined;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await f(url, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
            body,
            signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
          });
          if (res.ok) return parseResponse(await res.json().catch(() => null));
          const err = httpError(res.status);
          if (!isRetryable(err)) throw err;
          last = err;
          if (attempt < maxAttempts) await sleep(backoff(attempt, res.headers.get("retry-after")));
        } catch (e) {
          if (e instanceof AiError) {
            if (!isRetryable(e)) throw e;
            last = e;
          } else {
            const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
            last = new AiError(timeout ? "timeout" : "unavailable", timeout ? "Gemini request timed out" : "Gemini request failed (network)");
            if (attempt < maxAttempts) await sleep(backoff(attempt, null));
          }
        }
      }
      throw last ?? new AiError("unavailable", "Gemini unavailable");
    },
  };
}

const isRetryable = (e: AiError) => e.category === "rate_limited" || e.category === "unavailable" || e.category === "timeout";

function httpError(status: number): AiError {
  if (status === 429) return new AiError("rate_limited", "Gemini rate limit or quota exceeded (429)", status);
  if (status >= 500) return new AiError("unavailable", `Gemini server error (${status})`, status);
  if (status === 401 || status === 403) return new AiError("no_credentials", `Gemini rejected the API key (${status})`, status);
  return new AiError("bad_request", `Gemini rejected the request (${status}) — check GEMINI_MODEL and the request shape`, status);
}

/** 1s, 2s, 4s… capped at 10s; honours Retry-After when the server provides one. */
function backoff(attempt: number, retryAfter: string | null): number {
  const secs = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs, 10) * 1000;
  return Math.min(1000 * 2 ** (attempt - 1), 10_000);
}

interface GeminiResponse {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  promptFeedback?: { blockReason?: string };
}

function parseResponse(json: unknown): unknown {
  const r = json as GeminiResponse | null;
  if (!r || typeof r !== "object") throw new AiError("invalid_output", "Gemini returned a non-JSON response");
  if (r.promptFeedback?.blockReason) throw new AiError("blocked", `Gemini blocked the prompt (${r.promptFeedback.blockReason})`);
  const cand = r.candidates?.[0];
  if (!cand) throw new AiError("invalid_output", "Gemini returned no candidates");
  if (cand.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(cand.finishReason))
    throw new AiError("invalid_output", `Gemini stopped early (${cand.finishReason})`);
  const text = (cand.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
  if (!text.trim()) throw new AiError("invalid_output", "Gemini returned an empty reply");
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("invalid_output", "Gemini reply was not valid JSON");
  }
}
