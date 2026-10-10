import { z } from "zod";
import { ProviderError, type SearchHit, type SearchProvider } from "./types";

/**
 * Tavily search adapter — POST https://api.tavily.com/search, Bearer auth.
 * One `basic` search = 1 credit. `filter_by_published_date` drops results with no detectable date,
 * which is what we want: an undated page cannot be proven to be inside the 30-day window.
 */
const ResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      content: z.string().nullish(),
      score: z.number().nullish(),
      published_date: z.string().nullish(),
    }),
  ),
});

export interface TavilyOptions {
  apiKey?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createTavily(opts: TavilyOptions = {}): SearchProvider {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxAttempts = opts.maxAttempts ?? 3;

  return {
    name: "tavily",
    async search(q) {
      const apiKey = opts.apiKey ?? process.env.TAVILY_API_KEY;
      if (!apiKey) throw new ProviderError("no_credentials", "TAVILY_API_KEY is not set");
      const body = JSON.stringify({
        query: q.query,
        topic: "general",
        search_depth: "basic",
        max_results: q.maxResults,
        start_date: q.startDate,
        end_date: q.endDate,
        include_published_date: true,
        filter_by_published_date: true,
      });

      let last: ProviderError | undefined;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let res: Response;
        try {
          res = await f("https://api.tavily.com/search", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
            body,
            signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
          });
        } catch (e) {
          const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
          last = new ProviderError(timeout ? "timeout" : "http_5xx", timeout ? "Tavily request timed out" : "Tavily request failed (network)");
          if (attempt < maxAttempts) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
          continue;
        }
        if (res.ok) return parse(await res.json().catch(() => null));

        if (res.status === 401) throw new ProviderError("no_credentials", "Tavily rejected the API key (401)", 401);
        if (res.status === 432 || res.status === 433) throw new ProviderError("quota_exhausted", `Tavily plan or credit limit reached (${res.status})`, res.status);
        if (res.status === 429) {
          last = new ProviderError("rate_limited", "Tavily rate limit (429)", 429);
          const ra = Number(res.headers.get("retry-after"));
          if (attempt < maxAttempts) await sleep(Number.isFinite(ra) && ra >= 0 ? Math.min(ra, 10) * 1000 : Math.min(1000 * 2 ** (attempt - 1), 8000));
          continue;
        }
        if (res.status >= 500) {
          last = new ProviderError("http_5xx", `Tavily server error (${res.status})`, res.status);
          if (attempt < maxAttempts) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
          continue;
        }
        throw new ProviderError("http_4xx", `Tavily rejected the request (${res.status})`, res.status);
      }
      throw last ?? new ProviderError("http_5xx", "Tavily unavailable");
    },
  };
}

function parse(json: unknown): SearchHit[] {
  const p = ResponseSchema.safeParse(json);
  if (!p.success) throw new ProviderError("malformed", "Tavily response did not match the expected shape");
  return p.data.results.map((r) => ({
    url: r.url,
    title: (r.title ?? "").trim(),
    snippet: (r.content ?? "").trim(),
    published_date: r.published_date ?? null,
    score: r.score ?? 0,
  }));
}
