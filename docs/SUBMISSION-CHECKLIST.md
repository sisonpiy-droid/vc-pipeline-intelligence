# Submission checklist

Legend: **[x] Tested** = an automated test or a manual check was actually run · **[~] Built** = code complete but
**not yet verified against the real service / deployment** · **[ ] Not done**.

> Source: *Cohort 4 Term 1 AI Final Evaluation* (Hard level). **Build deadline EOD 12 Oct 2026; viva 15 Oct, 2:00–8:00 PM.**

## Build rubric (60 marks) → where each is

| Component | Weight | Where | Status |
|---|---|---|---|
| Components Map | 10% | `docs/components-map.png` / `.html` (only components that exist; status chips) | [x] status chips reflect live verification |
| Working Vercel link | 10% | https://vc-pipeline-intelligence.vercel.app | [x] live, connected to Supabase, populated by real refreshes |
| Design | 10% | 6 pages, token-based light/dark system, responsive, loading/empty/error states | [x] checked in browser at desktop and 375 px |
| Backend logic & build quality | 25% | `src/lib/**`, `supabase/migrations`, 302 tests | [x] incl. live run + live boundary check |
| Demo video | 5% | script in `docs/DEMO.md` | [ ] recording is yours |
| Viva (40%) | — | `docs/VIVA.md` | prep done |

## Assignment requirements

| # | Requirement | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Find observable investor signals from the previous 30 days | [x] | Two real production runs (82/82, 0 errors). Run 2: 65 verified signals, e.g. Avaana Capital led Drivn's Rs 45 Cr seed (21 Sep), Prime Venture Partners "Seed Plus" (7 Oct), Peak XV raised its Surge seed cap to $5M. |
| 2 | Public activity categories (articles, interviews/podcasts, portfolio investments, statements, events, thesis announcements) | [x] | All seven categories in schema; the live run produced portfolio investments, fund/thesis announcements, articles, interviews/podcasts and event appearances. |
| 3 | Explain why a signal makes an investor relevant | [x] | `signals.relevance_explanation` (validated, sanitised) shown on cards; tested. |
| 4 | Recommend who to contact now and why | [x] | Deterministic score + action + explanation (`tests/scoring.test.ts`, 22 cases); UI verified in browser on fixture data. |
| 5 | Include investors with no verified signals | [x] | `/quiet` lists all, grouped into 5 states; partition of the 82 asserted in `tests/read.test.ts`; UI verified. |
| 6 | Refresh twice weekly | [~] | `vercel.json` cron `0 4 * * 1,4` is deployed; the refresh path itself was proven live via the manual trigger (same code, chained across invocations). **First scheduled firing is Mon 12 Oct 04:00 UTC and has not been observed yet.** |
| 7 | Keep Supabase data up to date on every run | [x] | Live runs write signals, coverage, audit and the four columns to Supabase (82 records updated per run). |
| 8 | Preserve manual notes and contact history | [x] | Whole-row snapshot tests across success, repeat, partial failure; DB role cannot read them. |
| 9 | Update only the four permitted columns | [x] | zod allowlist + `vc_refresh` role (`tests/db.roles.test.ts`: 13 cases) + snapshot tests + `npm run verify:boundary` against live Supabase (notes/status writes and reads denied by the database). |
| 10 | Use live external data wherever possible | [x] | Live Tavily search + live page fetch with page-metadata dates. Official-site crawling **not implemented** (limitation). |
| 11 | Gemini Flash for all AI; no Claude API | [x] | Only `src/lib/ai/gemini.ts` calls a model (`gemini-3.6-flash`, confirmed to exist by `check:live`); no fallback by design. Live structured output works; validators caught 3 fabricated quotes across the two runs. |
| 12 | Deploy on Vercel | [x] | https://vc-pipeline-intelligence.vercel.app (all five configuration checks green at `/api/health`). |
| 13 | Public URL · GitHub repo · Components Map | [x] | URL above · https://github.com/sisonpiy-droid/vc-pipeline-intelligence · `docs/components-map.png`. |

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
| Automated tests | [x] **302 passing**, typecheck clean, production build clean |
| `.env.example` | [x] |
| README · API/architecture docs | [x] `README.md`, `docs/ARCHITECTURE.md` |
| Components Map | [~] reflects only components that exist; live-status badges to be updated after verification |
| Demo script / video plan | [x] `docs/DEMO.md` · [ ] recording |
| Viva explanation | [x] `docs/VIVA.md` |
| Provider evaluation, cost estimate | [x] `docs/PROVIDERS.md` (some vendor figures are third-party/unverified and labelled) |
| GitHub-ready repository | [x] local git history with checkpoints; **not pushed** |

## Live verification log (what was actually run)

1. `npm run check:live` - all green: DB migrated, Gemini model exists, structured JSON works, Tavily dated search, SSRF-guarded fetch.
2. Query probe (4 investors x 3 styles): boolean/quoted queries found almost nothing; plain natural-language queries returned on-topic news, so the app uses those.
3. **Run 1 on production** (manual trigger, chained invocations): 82/82, 0 errors, ~9.5 min, 104 verified signals. Review showed evergreen profiles and an IPO shareholder list ranked as "signals".
4. Fix: `specific_recent_event` field, stricter involvement/portfolio definitions in the prompt, profile/directory URL filter (+3 tests).
5. **Run 2 on production** (after clearing derived evidence only): 82/82, 0 errors, 65 verified signals; 28 profile pages and 7 non-events rejected. Top results are real, checkable events.
6. Review of run 2 showed 27 investors flagged "needs review" because any unfetchable page counted as incomplete coverage. Fix: coverage is "partial" only when a failed fetch actually prevented a decision (+1 test).
7. **Run 3 on production**: 82/82, 0 errors. Cached verdicts meant 93 candidates instead of 280 and only 13 new signals; 0 duplicate (investor, URL) rows after three runs; dashboard 20 active / 62 quiet / 0 needing review; founder columns unchanged (all 82 still `not_contacted`, no notes).
8. `npm run verify:boundary` against live Supabase: all denials/permissions as designed.
9. **LinkedIn + UI links (run 4 on production)**: a LinkedIn-restricted search per investor (the app never fetches LinkedIn itself). Live probe showed Tavily returns LinkedIn posts but leaves them undated, so dates are decoded from the timestamp inside the post ID (cross-checked against a post Tavily dated: 13 Nov decoded vs 15 Nov estimate, the consistent direction since Tavily's estimate lags). Result: 82/82, 0 errors, 69 verified LinkedIn signals (confidence capped at medium), 116 non-mentions / 56 profile pages / 96 not-involved rejected. Dashboard then showed 33 active, 6 "reach out now".
10. **Improvement phases 0-2 (after the reference study)**: credit planner with budget (tested; a manual run inside 36 h now costs nothing); `/brief`, evidence funnel, credit meter, freshness chips; official-feed discovery (measured 9/50 firms, live run on 3 firms `official_feed: ok`); founder edit workflow with refresh-preservation and CRM-effect tests; grounded opening angle (reused while the signal is unchanged); new-capital flag, source tiers, 5 sourced aliases; GSAP interaction layer.
11. `npm run eval:live`: **10/10 golden AI cases pass against live Gemini** (the three real failures, a prompt injection, new-capital and official-post cases).
12. Live smoke test of the new pipeline: `refresh:some` on 3 firms = **3 search credits**, run succeeded, credit meter counted exactly 3, feed signals dated `feed`, angle generated for Lightspeed. Production deploy verified: all routes 200; browser checks of the hero, live search (`/` shortcut) and mobile overflow on 5 pages.
13. Not verifiable here: mobile animation timing (the preview pane reported `document.hidden`), and the **scheduled** cron firing (first due Mon 12 Oct 04:00 UTC).
14. CI: the workflow is ready (`docs/ci.yml.example`) but **not active**: pushing it needs the GitHub token `workflow` scope (`gh auth refresh -s workflow`, then move it to `.github/workflows/ci.yml`).
15. Still unobserved: the **scheduled** cron firing (first due Mon 12 Oct 04:00 UTC).

## Known limitations

Official-site crawling not built · one search query per investor (recall) · workbook data unverified (thesis, geography,
partners) · founder geography assumed India · strict CSP needs nonces · admin lockout counter is per-instance.
