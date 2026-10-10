export type ProviderErrorCategory =
  | "no_credentials" | "rate_limited" | "quota_exhausted" | "timeout" | "http_5xx" | "http_4xx" | "malformed" | "blocked";

export class ProviderError extends Error {
  constructor(public category: ProviderErrorCategory, message: string, public status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface SearchQuery {
  query: string;
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string;
  maxResults: number;
}

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  /** Date as reported by the search provider — an ESTIMATE; page metadata outranks it. */
  published_date: string | null;
  score: number;
}

/** Anything that can discover pages. Tavily is the implementation; a second provider is another file. */
export interface SearchProvider {
  readonly name: string;
  search(q: SearchQuery): Promise<SearchHit[]>;
}

export interface FetchedPage {
  finalUrl: string;
  html: string;
}

export interface PageFetcher {
  fetch(url: string): Promise<FetchedPage>;
}
