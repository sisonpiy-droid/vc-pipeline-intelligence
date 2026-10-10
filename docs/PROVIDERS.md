# Providers, quotas and cost

Facts marked **(verified)** come from the vendor's documentation as read during this build (Oct 2026).
Anything else is labelled as an assumption. Prices and free tiers change — re-check before relying on them.

## Search / discovery

| Provider | Verdict | What I verified |
|---|---|---|
| **Tavily** — *integrated (primary)* | essential | `POST https://api.tavily.com/search`, `Authorization: Bearer`. Supports `start_date`/`end_date`, `include_published_date`, `filter_by_published_date` (drops undated results — exactly what a 30-day window needs), `max_results` ≤ 20. `basic` search = **1 credit**, `advanced` = 2. Errors: 401 key, 429 (optional `Retry-After`), **432/433 plan or PAYG limit**, 500. Docs state `published_date` is an *estimate* and may be later than the real date — hence the app prefers the page's own metadata and caps confidence when only the estimate exists. **Live finding:** Tavily is a semantic engine. Quoted names plus boolean `OR` chains returned almost nothing, while a plain "<name> investment announcement" returned on-topic news; the app uses the plain form. Free "Researcher" plan: reported as **1,000 credits/month** (third-party sources; confirm in the Tavily dashboard). Docs give no RPM figure; dev keys reportedly ~100 RPM. |
| Brave Search API — *not integrated* | optional fallback | Free-tier status is **contradictory across sources** (a free plan, $5/month credit, or none). Would sit behind the same `SearchProvider` interface; not worth integrating without a key and a confirmed free tier. |
| SerpAPI / Google Custom Search — *not integrated* | not needed | Not evaluated in depth. Google CSE availability to new projects is restricted and it returns no reliable publication date. |
| Direct official sites | partially | Official domains get higher de-duplication authority when they appear in results. **Not crawled independently** (see README limitations). |

## Page extraction

Direct HTTP fetch + regex metadata extraction (`providers/extract.ts`) — no Firecrawl/Jina. Reason: the app needs only
**one** thing from a page (its publication date and text for quote-verification), JSON-LD/Open Graph carry it on most
news and blog pages, and a hosted extractor would add cost, a second credential and a third-party data flow for no
gain. Trade-off: JavaScript-rendered pages with no server-side metadata fall back to the search snippet (confidence capped) or are dropped.

## AI

**Gemini Flash only** (`gemini-3.6-flash` at build time — the id shown as current on ai.google.dev; `npm run check:live`
asks the API whether the configured model exists). REST `generateContent` with `responseMimeType: application/json` + `responseSchema`.
List price seen on the docs page: ~$1.50 / 1M input, ~$7.50 / 1M output tokens **(verify; this is a paid-tier figure, no free tier assumed)**.
No other model is called, ever: on failure the adapter throws a typed `AiError` and the run reports it.
Claude is the *development* tool only.

## Database & hosting

Supabase Postgres (free tier assumed; the dataset is a few thousand rows). Vercel Hobby: **verified** cron minimum interval
is once per day with ±59 min precision (so Mon+Thu fits), functions up to 300 s with Fluid compute (default), 100 cron jobs/project.

## Expected usage per full refresh (82 targets = 50 firms + 32 angels)

| Resource | Per run | Per month (2 runs/week ≈ 8.7 runs) | Notes |
|---|---|---|---|
| Tavily searches | **82** (1 credit each) | **≈ 710** | leaves ≈ 290 of 1,000 free credits for development and manual runs |
| Page fetches | ≤ 8 per investor, typically ~2–4 → ~250 | ~2,200 | no vendor cost; polite UA, robots.txt, per-host failures tolerated |
| Gemini calls | ≤ 1 per investor *with candidates* (batched), +≤1 retry on invalid output → typically **30–60**, worst case ~164 | ~260–520 typical | URLs already judged are never re-analysed, so later runs call far less |
| Gemini tokens | ≈ 5–9k input per call (≤6 pages × ≤5,000 chars) | ≈ 0.3–0.6 M input typical | rough: **well under $1 per run** at the price above; unverified estimate |
| DB statements | ≈ 25 per investor ≈ 2,000 | ≈ 18,000 | negligible |

Controls: manual runs limited to one per 10 minutes; one active run; per-investor candidate cap (6); content-hash +
verdict caching; search is the only per-investor cost that scales linearly.
