# VC Fundraising Pipeline Intelligence

Which investors should a first-time founder contact **this week** — and what public evidence says so?

Built for Vikram: a first-time founder raising a **Seed** round for a **B2B logistics SaaS**, tracking ~50 VCs
(plus a separate list of angels). The app searches public sources for investor activity in the **last 30 days**,
verifies each piece of evidence, scores every investor with a fixed explainable formula, and ranks who to approach —
without ever overwriting the founder's own notes, contact history or relationship status.

> **Status.** Deployed and verified live: three real production refreshes completed 82/82 with 0 errors, and the
> data-safety boundary was verified on the real Supabase database. Not yet observed: the first *scheduled* cron firing
> (Mon 12 Oct 04:00 UTC). See [docs/SUBMISSION-CHECKLIST.md](docs/SUBMISSION-CHECKLIST.md) for the full log.

**Live:** https://vc-pipeline-intelligence.vercel.app · **Repo:** https://github.com/sisonpiy-droid/vc-pipeline-intelligence

## What it does

| | |
|---|---|
| **Discovers** | Tavily search per investor, restricted to the last 30 days and to dated results only |
| **Verifies** | fetches the page (SSRF-guarded, robots.txt-aware), reads the date from page metadata, checks the investor is actually named, rejects stale / undated / contradictory / duplicate evidence |
| **Analyses** | Gemini Flash classifies each signal and judges relevance — its output is schema-validated and every quoted excerpt must appear **verbatim** in the fetched page |
| **Scores** | deterministic 0–100: recency 30 · relevance 30 · evidence 20 · fit 15 · relationship 5 ([docs/SCORING.md](docs/SCORING.md)) |
| **Recommends** | reach out now · prepare targeted outreach · wait for response · research further · no action — each with a reason |
| **Protects** | the refresh runs as a Postgres role that can `UPDATE` only `last_signal_date`, `signal_summary`, `follow_up_score`, `recommended_action` and cannot even *read* notes or contact history |
| **Never confuses failure with quiet** | a failed search keeps the previous score and shows as "Failed refresh"; partial coverage shows as "Needs review"; only a *complete* empty search is "Quiet" |

Status pills, relationship, sector and category labels are links that filter the pipeline or signal feed.

Pages: **Priority queue** (`/`) · **Weekly brief** (`/brief`) · **Pipeline** (`/pipeline`) · **Investor detail** (`/investors/:id`) ·
**Signal feed** (`/signals`) · **Quiet investors** (`/quiet`) · **Runs & audit** (`/runs`).
**Signal feed** (`/signals`) · **Quiet investors** (`/quiet`) · **Runs & audit** (`/runs`).

## Quick start (local, no accounts needed)

```bash
npm install
cp .env.example .env            # then set DATABASE_URL=pglite://.data/dev  (in-process Postgres)
npm run import                  # applies the migration, imports data/india_vc_and_angel_profiles.xlsx (82 investors)
npm run dev                     # http://localhost:3000
npm test                        # 302 tests, ~30 s
```

To see a populated dashboard without API keys: `npm run dev:fixture` runs the **real pipeline** over canned
providers into the local pglite database. Every fixture article is titled `[FIXTURE]`, and the script refuses to run
against anything except `pglite://`, so fixture data can never reach Supabase.

## Going live

1. **Supabase**: create a project → *Connect* → copy the **Transaction pooler** string into `DATABASE_URL`.
   `npm run db:migrate` applies [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql), then `npm run import`.
2. **Keys** in `.env` (see [.env.example](.env.example)): `GEMINI_API_KEY`, `TAVILY_API_KEY`, `CRON_SECRET`, `ADMIN_PASSCODE`.
3. **Verify the real integrations** (≈1 search credit + 2 Gemini calls, writes nothing): `npm run check:live`.
4. **Vercel**: import the repo, set the same environment variables, deploy. [vercel.json](vercel.json) schedules
   `GET /api/cron/refresh` every **Monday and Thursday 04:00 UTC** (twice weekly). Vercel sends `CRON_SECRET` automatically.
5. On a public deployment consider `HIDE_PRIVATE_NOTES=1` so personal notes are not shown to visitors.

## Data safety (the core guarantee)

`investors` columns have three owners — documented at the top of the migration:

- **Founder-owned** (`partner_name`, `last_contact_date`, `relationship_status`, `contact_history`, `personal_notes`, …): written only at first import or by the founder.
- **Profile** (website, sectors, stage, …): written only by the importer; re-import is idempotent and never touches the other two groups.
- **Signal-derived** (the four columns): the **only** thing a refresh writes.

Enforced in three independent layers — a strict zod allowlist in `applySignalUpdate`, SQL built from a constant column list,
and the `vc_refresh` database role. **Tested** by `tests/refresh.test.ts` (row-level before/after snapshots across
success, repeated runs, partial failure, hostile model output) and `tests/db.roles.test.ts` (the database itself refuses).

## Layout

```
src/lib/db         Db interface: pg (Supabase) | PGlite (tests, local dev) · migration runner
src/lib/investors  workbook → normalised, de-duplicated records → idempotent upsert
src/lib/providers  Tavily adapter · SSRF-safe page fetcher · metadata date extraction
src/lib/ai         Gemini REST adapter (typed errors, bounded retry, no fallback model) · output verification
src/lib/signals    30-day window · entity matching · event de-duplication
src/lib/scoring    deterministic score + action rules
src/lib/refresh    research → process → durable chunked run lifecycle → four-column write service
src/lib/read.ts    dashboard read model (state derivation, filters, feeds)
src/app            pages + /api/cron/refresh · /api/refresh · /api/refresh/continue · /api/health
supabase/migrations  schema, ownership boundary, least-privilege role, RLS
tests/             302 tests; the real migration runs on PGlite
docs/              architecture, scoring, providers & costs, references, demo, viva, checklist, components map
```

## Free-tier guard rails (Tavily is the metered resource)

A full refresh costs about 82 search credits (164 with LinkedIn), against ~1,000 free per month. The planner (`src/lib/refresh/plan.ts`) therefore decides *who* a run searches:

- investors checked in the last **36 h** are skipped (a manual run right after the cron run costs nothing);
- **cold** investors (two empty checks in a row) are searched about **weekly**, not every run;
- a **monthly budget** (`TAVILY_MONTHLY_BUDGET`, default 900, minus `TAVILY_CREDITS_BASELINE` spent outside tracked runs) caps spending, highest-value investors first (active signal → retries → never-checked → stalest);
- **LinkedIn is opt-in per manual run** (a checkbox), never on the schedule;
- a run with nothing due completes instantly and uses **zero** credits.

Skipping is never a verdict: skipped investors keep their previous values and an honest "checked N days ago" chip, and are never shown as quiet. `/runs` shows the credit meter. If you create a fresh Tavily key, set `TAVILY_CREDITS_BASELINE=0`.

## Beyond the brief (each from the reference study, see docs/IMPROVEMENT-PLAN.md)

| Feature | What it does | Where |
|---|---|---|
| **Weekly brief** | New signals this run, score movers (needs two real checks), contact / prepare / hold lists, investors needing attention; printable | `/brief`, `src/lib/brief.ts` |
| **Evidence funnel** | Where each run's candidates were filtered out, with reasons | `/runs` |
| **Official-site feeds** | Reads a firm's own RSS/Atom feed over plain HTTP (free, dated by the feed). Measured: **9 of 50** firms publish one, 5 with a post in the last 30 days | `providers/feeds.ts`, `npm run check:feeds` |
| **Founder edit workflow** | Passcode-gated edit of status, last contact, contact history, notes; owner role, audited by field name only; tested that refreshes never overwrite it and that it changes recommendations | `lib/founder.ts`, `/api/investors/:id/founder` |
| **Grounded opening angle** | 1-2 sentences for "reach out now" investors, from the verified signal only; numbers/links not in the evidence are rejected; reused while the signal is unchanged | `ai/angle.ts` |
| **New fund capital flag, source tiers, sourced aliases** | Fund close / cheque-ceiling raise badge; Official / Press / social badges; former names with a cited source (Peak XV = Sequoia India, …) | `data/aliases.csv` |
| **Golden AI cases** | 10 cases incl. the three real production failures and a prompt-injection; **10/10 pass against live Gemini** | `npm run eval:live` |
| **Interaction layer** | GSAP (free "no charge" licence): scroll progress, count-ups, hero choreography, magnetic button, card tilt + spotlight, scrubbed timeline; `/` focuses live search. Reduced-motion respected | `src/components/motion/` |

Useful scripts: `npm run check:live` (real services, ~1 credit) · `npm run check:feeds` (free) · `npm run eval:live` (10 Gemini calls) · `npm run refresh:some -- "Seafund"` (real pipeline for named investors, 1 credit each) · `npm run verify:boundary` (DB role boundary).

## Open demo mode

The live deployment runs with `DEMO_OPEN=1`: the Refresh and Edit buttons need **no passcode**, so the app can be demonstrated freely. Anyone with the link can therefore edit notes and start refreshes; manual refreshes are still limited by a 10-minute cooldown and the monthly search-credit budget, edits can only touch the four founder-owned columns, and nothing a refresh does can overwrite them. **To lock it again:** set `DEMO_OPEN=0` and set `ADMIN_PASSCODE` in Vercel, then redeploy. Verified by `tests/demo.test.ts` (default is closed; only the exact value `1` opens it).

## Known limitations (stated up front)

- **LinkedIn is searched but never fetched** (its terms forbid it): posts are judged from search snippets, so their confidence is capped at "medium". No LinkedIn profile URLs are stored or guessed; profile pages link to a LinkedIn search instead.
- **Official sources are covered only where a firm publishes an RSS/Atom feed** (9 of 50 measured). Portfolio pages are not crawled: they rarely carry dates, so "new in the last 30 days" cannot be proven from a snapshot.
- **Search recall is bounded** by one Tavily query per investor (plus an optional LinkedIn query) to stay inside the free tier; see the guard rails above.
- **Workbook data is unverified**: geography is "India (confirm)", every thesis is "No – verify", partners are blank. The UI says so rather than guessing.
- The founder's geography is **assumed to be India** (the brief does not state it); it only affects the 15-point fit component.
- Vercel Hobby cron runs once-a-day-at-most with up to ~1 h jitter; twice weekly fits.
