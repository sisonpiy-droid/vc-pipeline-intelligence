import { AiError, DEFAULT_MODEL, type AiClient } from "./gemini";

/**
 * The backup route to the SAME model: Gemini Flash through OpenRouter (an OpenAI-compatible gateway). It exists so the product keeps
 * working when Google's free quota runs out or Google is down. It is only ever called after the Google route has failed, it asks for
 * the identical model, and it returns the same typed result or the same typed errors, so nothing downstream can tell the difference.
 */
export interface OpenRouterOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const URL = "https://openrouter.ai/api/v1/chat/completions";

/** Gemini's schema dialect writes types in capitals ("OBJECT"); JSON Schema wants lower case. Everything else carries over. */
export function toJsonSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (k === "propertyOrdering") continue;
    out[k] = k === "type" && typeof v === "string" ? v.toLowerCase() : toJsonSchema(v);
  }
  return out;
}

export function modelFor(env: Record<string, string | undefined> = process.env): string {
  return env.OPENROUTER_MODEL?.trim() || `google/${env.GEMINI_MODEL?.trim() || DEFAULT_MODEL}`;
}

function httpError(status: number): AiError {
  if (status === 429) return new AiError("rate_limited", "OpenRouter rate limit (429)", status);
  if (status === 402) return new AiError("unavailable", "OpenRouter has no credit left (402)", status);
  if (status >= 500) return new AiError("unavailable", `OpenRouter server error (${status})`, status);
  if (status === 401 || status === 403) return new AiError("no_credentials", `OpenRouter rejected the API key (${status})`, status);
  return new AiError("bad_request", `OpenRouter rejected the request (${status})`, status);
}

/** The reply text, with a Markdown code fence removed if the model added one. */
const unfence = (t: string) => t.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

export function createOpenRouter(opts: OpenRouterOptions = {}): AiClient {
  const f = opts.fetchImpl ?? fetch;
  return {
    async generateJson(req) {
      const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new AiError("no_credentials", "OPENROUTER_API_KEY is not set");
      let res: Response;
      try {
        res = await f(URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "x-title": "VC Pipeline Intelligence" },
          body: JSON.stringify({
            model: opts.model ?? modelFor(),
            temperature: 0.1,
            messages: [{ role: "system", content: req.system }, { role: "user", content: req.prompt }],
            response_format: { type: "json_schema", json_schema: { name: "reply", strict: false, schema: toJsonSchema(req.responseSchema) } },
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
        });
      } catch (e) {
        const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new AiError(timeout ? "timeout" : "unavailable", timeout ? "OpenRouter request timed out" : "OpenRouter request failed (network)");
      }
      if (!res.ok) throw httpError(res.status);
      const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string }; finish_reason?: string }[] } | null;
      const choice = json?.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new AiError("invalid_output", "OpenRouter returned an empty reply");
      try {
        return JSON.parse(unfence(text));
      } catch {
        throw new AiError("invalid_output", "OpenRouter reply was not valid JSON");
      }
    },
  };
}
