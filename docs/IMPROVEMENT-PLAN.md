# Improvement plan (proposal — nothing here is implemented until approved)

Basis: [REFERENCES.md](REFERENCES.md) + the three real production runs so far. Constraints: **free tiers only** (Tavily, Gemini Flash, Supabase, Vercel Hobby, direct HTTP), **Gemini only for runtime AI**, founder-owned data untouched by refresh, build deadline **EOD 12 Oct**, viva 15 Oct.

## 0. First, a free-tier problem I introduced (needs a decision regardless)

Tavily free plan ≈ **1,000 credits/month** (third-party figure; confirm in the Tavily dashboard → Usage).
Credits I have spent so far, estimated: ~430 (check-live, probes, four real runs). The LinkedIn query doubled a full run to **~164 credits**.

| Scenario for the rest of October | Credits | Fits ≈ 570 left? |
|---|---|---|
| 6 more scheduled runs *with* LinkedIn (Mon/Thu) | ~984 | **No** |
| 6 scheduled runs, LinkedIn off | ~492 | Barely, no manual runs |
| Adaptive budget (below) | ≤ ~400 | Yes, with headroom |

**Proposed fix (Phase 0, ~1 h):** a credit **budget guard** + **adaptive cadence** — count search calls per run in the DB; a configurable monthly cap (default 900); when near the cap, search only the highest-value investors (active signal, high fit, never-checked first) and mark the rest `skipped: budget` in coverage (explicitly *not* "quiet"). Quiet investors with 3 clean empty runs in a row move to every-other-run. LinkedIn search stays available but only for manual runs and investors with an active/high-fit profile.

## 1. Gaps found (by comparing against the references and our own runs)

| # | Gap | Evidence | Reference pattern |
|---|---|---|---|
| G1 | **No "what changed since last run"** — the dashboard shows state, not movement | none in UI | Fund Momentum `get_changes`; Fund Signal weekly brief; Roundkey daily briefing |
| G2 | **Founder-owned data cannot be edited in the product** (only via SQL), so the CRM half is undemonstrable | notes/status read-only | Outreachr, Roundkey CRM |
| G3 | Recall bounded by one search query; **official sites not read** (brief encourages direct official sources) | stated limitation | Fund Signal sources; FirstSignal ingest-per-source |
| G4 | AI prompt regressions are untested — we already fixed 3 real failures (IPO shareholder list, directory page, profile page) by hand | prompt edited after run 1 | Funding Intelligence golden cases |
| G5 | Score is presented without "what it is not" (not a probability, not calibrated) | UI/docs | Funding Intelligence `score_semantics`, `not_calibrated` |
| G6 | Evidence funnel exists in data but is not shown (discovered → named → in-window → verified → relevant) | rejection reasons stored | Arthaive `pipeline_jobs` |
| G7 | Aliases only from the workbook; rebrands (Peak XV ⇄ Sequoia India) hurt recall | e.g. Peak XV search term | Arthaive alias tables |
| G8 | Freshness is only visible on the detail page | list pages | Fund Momentum per-record `last_checked` |
| G9 | No CI | repo has none | Investor Relations MCP workflows |
| G10 | Capital-event signals (fund close, seed-cap raised) are not distinguished from other news | e.g. Peak XV $5M seed cap | Fund Momentum "fund just closed" |
| G11 | No review state for uncertain evidence beyond a filter | `needs_review` rows | Arthaive review queue |
| G12 | No suggested angle for outreach on top-ranked investors | none | Fund Signal opening line; PitchDekh email draft |

## 2. Proposed architecture (additions only; everything existing stays)

```
Discovery (per investor, per run)
  ├─ Tavily web search            (existing; credit-budgeted, adaptive cadence)         ← Phase 0
  ├─ Tavily LinkedIn search       (existing; manual runs + high-value investors only)   ← Phase 0
  └─ Official-site feeds (NEW)    direct HTTP: <link rel=alternate> RSS/Atom, /feed, /blog/feed, sitemap
                                   → items dated by the feed itself, authority 5, ZERO credits   ← Phase 2
        ▼  same validation stack (entity, window, dedupe, Gemini verify, verbatim quote)
Persist + score (unchanged) ──► run_items.outcome gains: gate trace, deltas, talking point
        ▼
Read model (NEW): changes-since-last-run, funnel per run, freshness per investor
        ▼
UI (NEW): /brief  ·  evidence funnel on /runs  ·  freshness chips  ·  startup-profile panel  ·  founder edit form
Founder edits (NEW): passcode-gated server action, OWNER role, founder-owned columns only, audit-logged (field names, never contents)
Quality (NEW): golden Gemini cases (`npm run eval:live`) · GitHub Actions CI (typecheck, tests, npm audit)
```
No new runtime dependency, no paid service, no new table except small additive columns (migration 0003).

## 3. Specific changes

| Change | Files (new/changed) | Addresses | Tests |
|---|---|---|---|
| **Credit budget guard + adaptive cadence** | `runs.search_calls` (migration), `refresh/research.ts`, `refresh/run.ts` (priority order), coverage `skipped:budget`, `/runs` budget meter | §0 | budget exhaustion → skipped not quiet; ordering; month rollover |
| **Brief page `/brief`** — new signals this run, score movers (▲/▼ vs previous run), investors to contact / hold, failures needing attention; printable | `read.ts` (deltas from consecutive `run_items.outcome`), `app/brief/page.tsx` | G1, G12 | delta computation incl. first run, failed run in between |
| **Founder edit workflow** — relationship status, last contact, contact history entries, personal notes; passcode-gated; owner role; audit entry; **refresh-preservation test re-run after edits** | `app/investors/[id]/edit` (server action), `lib/founder.ts`, audit | G2, brief's "authenticated manual-edit workflow" | edits persist across refresh; refresh role still cannot read them; bad passcode rejected; audit has field names only |
| **Evidence funnel on `/runs`** | `read.ts`, `runs/page.tsx` | G6 | counts reconcile with `signals` by reason |
| **Freshness chips** (checked N h/d ago; amber if > 7 d) on cards, table, detail | `ui.tsx`, cards | G8 | formatter |
| **Policy-score honesty + startup-profile panel** (sector, stage, geography *assumed India*, weights, "not a probability") | `InvestorCard`, overview rail, `docs/SCORING.md` | G5 | — |
| **Golden AI cases** from real failures + a few good signals; `npm run eval:live` runs them against Gemini and asserts verdicts | `tests/evals/*.json`, `scripts/eval-live.ts` | G4 | offline: case schema + validator; live: on demand |
| **Official-site feed discovery** | `providers/feeds.ts` (RSS/Atom parse, SSRF-safe fetcher reused), `research.ts` | G3 | feed parsing, window filter, dedupe vs search hit, robots, failure ⇒ partial |
| **Alias curation file with source URL per alias** (e.g. Peak XV ⇄ Sequoia Capital India) merged by the importer, flagged `alias_curated` | `data/aliases.csv`, `import.ts` | G7 | importer merge; never overwrites founder fields |
| **`new_capital` flag** (fund close / cap raise) from Gemini → badge + explanation (no weight change) | schema + prompt + migration 0003, `SignalCard` | G10 | schema; badge |
| **Source tier badge** (official · press · social/aggregator) | `format.ts`, cards | provenance | tier mapping |
| **Outreach angle** (≤ 2 sentences, from the verified signal only) for investors at "reach out now"; stored in `run_items.outcome`; generated in the refresh | `ai/analyze.ts` or new `ai/angle.ts` | G12 | grounded-in-signal check; failure ⇒ omitted |
| **GitHub Actions CI** | `.github/workflows/ci.yml` | G9 | — |
| **Review state for uncertain evidence** (approve/reject `needs_review`) | owner-role action, `/signals?show=review` | G11 | (Phase 3) |

## 4. Phased plan

| Phase | Scope | Est. | Why this order |
|---|---|---|---|
| **0 — Free-tier safety** | Budget guard + adaptive cadence; LinkedIn only where it pays | ~1 h | Prevents the Monday cron from exhausting Tavily and breaking the live demo |
| **1 — Demo-value, low risk** | `/brief` with deltas · evidence funnel · freshness chips · policy-score + profile panel · golden AI cases · CI | ~3 h | Visible in the video and viva; no new data sources; low regression risk |
| **2 — Real capability** | Founder edit workflow · official-site feeds · alias curation · new-capital flag · source tiers · outreach angle | ~4–5 h | Closes the two honest gaps (CRM can't be edited; official sources unread) |
| **3 — After submission** | Review queue · RSS news sources (Inc42/Entrackr/YourStory — validate feed depth first) · optional keyless Fund Momentum cross-check · public-dataset expansion | later | Needs licence/terms checks or has diminishing returns |

**Recommendation given the deadline:** do **Phase 0 + Phase 1 today**, then **founder edit + official-site feeds** from Phase 2 only if time remains after you record the demo; leave the rest for the viva as "known next steps". Each phase ends green (typecheck, tests, build), is committed separately, and is deployed only after you say so.

## 5. What stays untouched
Founder-owned columns and the four-column write boundary (we add tests, never loosen it) · Gemini-only AI · no paid dependency · existing pages and data · all 221 tests.
