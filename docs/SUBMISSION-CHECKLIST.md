# Submission checklist

Legend: **[x] Tested** = an automated test or a manual check was actually run · **[~] Built** = code complete but
**not yet verified against the real service / deployment** · **[ ] Not done**.

> Source: *Cohort 4 Term 1 AI Final Evaluation* (Hard level). **Build deadline EOD 12 Oct 2026; viva 15 Oct, 2:00–8:00 PM.**

## Build rubric (60 marks) → where each is

| Component | Weight | Where | Status |
|---|---|---|---|
| Components Map | 10% | `docs/components-map.png` / `.html` (only components that exist; status chips) | [x] — chips to be flipped to "verified" after live run |
| Working Vercel link | 10% | https://vc-pipeline-intelligence.vercel.app | [~] deployed & healthy; **shows a setup error until `DATABASE_URL` (Supabase) is added** |
| Design | 10% | 6 pages, token-based light/dark system, responsive, loading/empty/error states | [x] checked in browser at desktop and 375 px |
| Backend logic & build quality | 25% | `src/lib/**`, `supabase/migrations`, 209 tests | [x] logic · [~] live providers unverified |
| Demo video | 5% | script in `docs/DEMO.md` | [ ] recording is yours |
| Viva (40%) | — | `docs/VIVA.md` | prep done |

## Assignment requirements

| # | Requirement | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Find observable investor signals from the previous 30 days | [~] | Pipeline built and tested with provider doubles (`tests/refresh.test.ts`). **Not yet run against live Tavily/Gemini** — run `npm run check:live`, then one real refresh. |
| 2 | Public activity categories (articles, interviews/podcasts, portfolio investments, statements, events, thesis announcements) | [~] | Seven categories in schema + Gemini classification schema; classification quality unverified live. |
| 3 | Explain why a signal makes an investor relevant | [x] | `signals.relevance_explanation` (validated, sanitised) shown on cards; tested. |
| 4 | Recommend who to contact now and why | [x] | Deterministic score + action + explanation (`tests/scoring.test.ts`, 22 cases); UI verified in browser on fixture data. |
| 5 | Include investors with no verified signals | [x] | `/quiet` lists all, grouped into 5 states; partition of the 82 asserted in `tests/read.test.ts`; UI verified. |
| 6 | Refresh twice weekly | [~] | `vercel.json` cron `0 4 * * 1,4`, test keeps dashboard schedule in step. **Not yet running on Vercel.** |
| 7 | Keep Supabase data up to date on every run | [~] | Same SQL runs on PGlite in tests. **Supabase project not connected yet** (needs `DATABASE_URL`). |
| 8 | Preserve manual notes and contact history | [x] | Whole-row snapshot tests across success, repeat, partial failure; DB role cannot read them. |
| 9 | Update only the four permitted columns | [x] | zod allowlist + `vc_refresh` role (`tests/db.roles.test.ts`: 13 cases) + snapshot tests. |
| 10 | Use live external data wherever possible | [~] | Tavily + direct page fetch implemented. Live verification pending. Official-site crawling **not implemented**. |
| 11 | Gemini Flash for all AI; no Claude API | [~] | Only `src/lib/ai/gemini.ts` calls a model; no fallback by design (tested: 500s → typed error, requests only ever to `generativelanguage.googleapis.com`). Live call pending. |
| 12 | Deploy on Vercel | [ ] | Config ready (`vercel.json`, env docs). Needs your Vercel project + env vars + approval. |
| 13 | Public URL · GitHub repo · Components Map | [ ] URL · [ ] repo · [~] map | Map is at `docs/components-map.html`; repo not pushed; URL not deployed. |

## Build-prompt deliverables

| Deliverable | Status |
|---|---|
| Working application (6 pages) | [x] builds (`next build`), renders real data locally, mobile layout checked at 375 px |
| Database migrations | [x] `supabase/migrations/0001_init.sql` — applied to PGlite in every test run; **not yet applied to Supabase** |
| Investor import workflow | [x] 50 VCs + 32 angels from the real workbook → 82 investors, 0 issues; idempotent; re-import preserves founder data (tested) |
| Search & extraction integrations | [~] Tavily adapter + SSRF-safe fetcher + date extraction: 42 tests with local servers / mocked HTTP; not live |
| Gemini Flash analysis | [~] adapter + validation tested with doubles (22 tests); not live |
| Explainable scoring | [x] |
| Safe signal-only updates | [x] |
| Scheduled + manual refresh | [x] logic & auth tested (22 API tests); [~] on Vercel |
| Run monitoring & audit | [x] `/runs`, `audit_logs`, `source_coverage` |
| Automated tests | [x] **209 passing**, typecheck clean, production build clean |
| `.env.example` | [x] |
| README · API/architecture docs | [x] `README.md`, `docs/ARCHITECTURE.md` |
| Components Map | [~] reflects only components that exist; live-status badges to be updated after verification |
| Demo script / video plan | [x] `docs/DEMO.md` · [ ] recording |
| Viva explanation | [x] `docs/VIVA.md` |
| Provider evaluation, cost estimate | [x] `docs/PROVIDERS.md` (some vendor figures are third-party/unverified and labelled) |
| GitHub-ready repository | [x] local git history with checkpoints; **not pushed** |

## Tests that need live credentials (not run yet)

`npm run check:live` — environment, DB reachable + migrated, Gemini model id exists, Gemini structured output,
Tavily dated search, SSRF-guarded page fetch + date extraction. Then, after deploy: one real refresh and a look at
`/runs`, `/signals`, one investor's evidence at its source URL.

## Known limitations

Official-site crawling not built · one search query per investor (recall) · workbook data unverified (thesis, geography,
partners) · founder geography assumed India · strict CSP needs nonces · admin lockout counter is per-instance.
