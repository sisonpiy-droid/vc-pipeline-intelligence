import type { AiClient, AiRequest } from "@/lib/ai/gemini";
import { AiError } from "@/lib/ai/gemini";
import { ProviderError, type PageFetcher, type SearchHit, type SearchProvider } from "@/lib/providers/types";
import type { Deps } from "@/lib/refresh/research";

export const NOW = new Date("2026-10-11T12:00:00Z");
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

/** The sentence every fake article contains, so the fake AI can quote it verbatim. */
export const EXCERPT = "led a five million dollar Seed round in a freight marketplace for trucking fleets";

export const article = (firm: string, date: string | null, extra = "") =>
  `<html><head><title>${firm} backs logistics startup</title>${date ? `<meta property="article:published_time" content="${date}T08:00:00Z">` : ""}</head>` +
  `<body><article><p>${firm} ${EXCERPT}. ${"The round will fund expansion across Indian logistics corridors and enterprise freight customers. ".repeat(3)}${extra}</p></article></body></html>`;

export const hit = (url: string, firm: string, published_date: string | null = null): SearchHit => ({
  url, title: `${firm} backs logistics startup`, snippet: `${firm} ${EXCERPT}.`, published_date, score: 0.9,
});

type Reply = SearchHit[] | ProviderError;

export function fakeSearch(byFirm: Record<string, Reply>): SearchProvider & { queries: string[] } {
  const queries: string[] = [];
  return {
    name: "fake",
    queries,
    async search(q) {
      queries.push(q.query);
      const firm = Object.keys(byFirm).find((f) => q.query.includes(`"${f}"`));
      const r = firm ? byFirm[firm]! : [];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

export function fakePages(byUrl: Record<string, string | ProviderError>): PageFetcher & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    async fetch(url) {
      fetched.push(url);
      const r = byUrl[url];
      if (r === undefined) throw new ProviderError("http_4xx", "404", 404);
      if (r instanceof Error) throw r;
      return { finalUrl: url, html: r };
    },
  };
}

export interface AiRule {
  involvement?: "verified" | "unclear" | "not_involved";
  relevance?: number;
  confidence?: "high" | "medium" | "low";
  excerpt?: string;
  summary?: string;
}

/** A Gemini double: parses candidates from the prompt and answers from a per-URL rule table. */
export function fakeAi(rules: Record<string, AiRule> = {}, mode: "ok" | "garbage" | "down" | "malicious" = "ok"): AiClient & { calls: number; prompts: string[] } {
  const state = { calls: 0, prompts: [] as string[] };
  return {
    get calls() { return state.calls; },
    prompts: state.prompts,
    async generateJson(req: AiRequest) {
      state.calls++;
      state.prompts.push(req.prompt);
      if (mode === "down") throw new AiError("unavailable", "Gemini down");
      if (mode === "garbage") return { assessments: "not an array", extra: "<script>" };
      const cands = [...req.prompt.matchAll(/<candidate index="(\d+)" url="([^"]+)"/g)].map((m) => ({ index: Number(m[1]), url: m[2]! }));
      return {
        assessments: cands.map(({ index, url }) => {
          const r = rules[url] ?? {};
          return {
            index,
            investor_involvement: r.involvement ?? "verified",
            signal_type: "portfolio_investment",
            relevance: mode === "malicious" ? 100 : (r.relevance ?? 85),
            confidence: r.confidence ?? "high",
            evidence_excerpt: r.excerpt ?? EXCERPT,
            summary: mode === "malicious" ? "'); DROP TABLE investors; --\u0000\n<script>alert(1)</script>" : (r.summary ?? "Backed a logistics marketplace at Seed."),
            why_it_matters: "Shows active Seed investing in freight and logistics.",
          };
        }),
      };
    },
  };
}

export const mkDeps = (search: SearchProvider, pages: PageFetcher, ai: AiClient): Deps => ({ search, pages, ai, now: () => NOW });
