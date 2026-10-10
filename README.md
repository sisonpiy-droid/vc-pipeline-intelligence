# VC Fundraising Pipeline Intelligence

Which investors should a first-time founder contact **this week** — and what public evidence says so?

Built for Vikram: a first-time founder raising a **Seed** round for a **B2B logistics SaaS**, tracking ~50 VCs
(plus a separate list of angels). The app searches public sources for investor activity in the **last 30 days**,
verifies each piece of evidence, scores every investor with a fixed explainable formula, and ranks who to approach —
without ever overwriting the founder's own notes, contact history or relationship status.

> **Status honesty.** Everything below is marked **Tested** (automated test or manual check actually run),
> **Built, not yet verified live** (code complete, needs real API keys / deployment to prove), or **Not built**.
> See [docs/SUBMISSION-CHECKLIST.md](docs/SUBMISSION-CHECKLIST.md) for the full list.

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

Pages: **Priority queue** (`/`) · **Pipeline** (`/pipeline`) · **Investor detail** (`/investors/:id`) ·
**Signal feed** (`/signals`) · **Quiet investors** (`/quiet`) · **Runs & audit** (`/runs`).

## Quick start (local, no accounts needed)

```bash
npm install
cp .env.example .env            # then set DATABASE_URL=pglite://.data/dev  (in-process Postgres)
npm run import                  # applies the migration, imports data/india_vc_and_angel_profiles.xlsx (82 investors)
npm run dev                     # http://localhost:3000
npm test                        # 209 tests, ~30 s
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
tests/             209 tests; the real migration runs on PGlite
docs/              architecture, scoring, providers & costs, references, demo, viva, checklist, components map
```

## Known limitations (stated up front)

- **Official-site crawling is not implemented.** Official domains get higher authority when they appear in search results, but the app does not independently crawl portfolio pages (they rarely carry dates, so "new in the last 30 days" cannot be proven from one snapshot).
- **Search recall is bounded** by one Tavily query per investor to stay inside a free tier (~710 of ~1,000 monthly credits at two full runs a week).
- **Workbook data is unverified**: geography is "India (confirm)", every thesis is "No – verify", partners are blank. The UI says so rather than guessing.
- The founder's geography is **assumed to be India** (the brief does not state it); it only affects the 15-point fit component.
- Vercel Hobby cron runs once-a-day-at-most with up to ~1 h jitter; twice weekly fits.
