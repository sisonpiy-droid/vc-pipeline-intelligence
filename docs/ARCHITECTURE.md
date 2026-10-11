# Architecture

## 1. Shape of the system

```
Vercel Cron (Mon+Thu 04:00 UTC) ─┐
Dashboard "Refresh now" ─────────┼─► /api/cron/refresh · /api/refresh      (auth, single-active-run, cooldown)
                                 │            │ startRun(): runs row + one run_items row per investor (durable queue)
                                 │            ▼
                                 │   after() → work(): runChunk() ≤240 s ──► done? finalize.  not done? ─┐
                                 │            ▲                                                          │
                                 └────────────┴──────── POST /api/refresh/continue (CRON_SECRET) ◄───────┘

runChunk → claim 3 pending items (FOR UPDATE SKIP LOCKED) → processInvestor(inv):
   research:  Tavily search (30-day window, dated only) → per hit: page fetch (SSRF-safe, robots) → date from page
              metadata → entity check → window check → de-duplicate events → ≤6 candidates
   analyse:   ONE batched Gemini Flash call → zod schema → involvement=verified → excerpt must appear verbatim in page
   persist:   ONE transaction as role vc_refresh: signals · source_coverage · audit_logs · UPDATE the 4 columns · run_items
   score:     pure function over stored verified signals + profile + relationship → score, action, explanation
```

Next.js (App Router, TypeScript) serves both the UI (server components reading Postgres directly) and the API routes.
There is **no browser-side database client**, no service-role key and no Supabase Data API use: the server holds one
secret, `DATABASE_URL`, and row-level security denies the public API everything.

## 2. Why a durable queue (and not one long request)

82 investors × (1 search + several page fetches + 1 Gemini call) is minutes of work; a serverless function must not be
assumed to live that long (Vercel Hobby, Fluid compute: 300 s). So a run is data, not a request:

- `runs` (one active at a time — a **partial unique index**, so overlap protection is the database's job, not app logic)
- `run_items` (one row per investor: `pending → running → done | failed`, `attempts`, `outcome` JSON)

Each invocation claims a few items, processes them until its budget is spent, then hands the remainder to a **new**
invocation via an authenticated `POST /api/refresh/continue` (which returns 202 immediately and works in `after()`).

| Failure | What happens |
|---|---|
| Function killed mid-item | item stays `running`; reclaimed as `pending` after 5 min |
| Hand-off request lost | run heartbeat goes stale (>10 min); the next cron or manual trigger **resumes** the same run (no second run) |
| Search/AI transient error | retried inside the adapter (bounded, backoff, `Retry-After`), then item-level up to 3 attempts, then `failed` |
| Missing key / quota exhausted | non-retryable: fails immediately, item keeps previous score, run ends `partial` |
| DB error mid-persist | the investor's transaction rolls back (no half-written signals); item retried |
| Two triggers at once | one wins the unique index; the other gets `already_running` |
| Manual button spam | 10-minute cooldown (DB-backed) protects search/AI credits |

A run is `succeeded` only after **every** item is `done`; `partial` if some failed; `failed` if none succeeded.

## 3. Data ownership and the write boundary

See the header of `supabase/migrations/0001_init.sql`. Three owners (founder / profile / signal-derived). The refresh:

1. receives a `Db` from `asRefresh()` — **every statement runs as `vc_refresh`**;
2. `vc_refresh` has `SELECT` on all `investors` columns **except** `personal_notes` and `contact_history` (so `select *` fails),
   `UPDATE` on the four signal columns only, no `DELETE`, no `INSERT` on `investors`;
3. the only investor write is `applySignalUpdate`, which validates a strict zod schema and builds SQL from a constant list.

The importer is a different path (owner role): `INSERT … ON CONFLICT (name_key) DO UPDATE` whose `SET` list contains profile
columns only, guarded by `IS DISTINCT FROM` so an unchanged re-import writes nothing (stable `updated_at`).
`updated_at` itself is maintained by a trigger that ignores the four signal columns, so a refresh leaves the row
**byte-identical** outside those columns — which `tests/refresh.test.ts` asserts on whole-row snapshots.

## 4. Evidence validation (stage 4) — what is checked in code, not trusted from the model

| Check | Where |
|---|---|
| Publication date comes from the **page** (JSON-LD `datePublished`, `article:published_time`, meta, `<time>`); `dateModified` ignored | `providers/extract.ts` |
| Two page dates >2 days apart ⇒ `contradictory_dates`, rejected | `extract.ts` |
| LinkedIn post with no provider date ⇒ date decoded from the post ID (`date_source=post_id`); no ID ⇒ `missing_date` | `signals/linkedin.ts` |
| Only a search-provider date ⇒ accepted but `date_source=search_estimate`, confidence capped at *medium* | `research.ts`, `process.ts` |
| No date at all ⇒ `missing_date`, rejected — never defaulted to "recent" | `signals/window.ts` |
| Outside [now−30d, now+1d] ⇒ `out_of_window` / `future_date` | `signals/window.ts` |
| Investor must be named (whole-word name / alias / founder-entered partner); no fuzzy "stems" | `signals/match.ts` |
| Same event reported by several sites ⇒ one kept (official source preferred), the rest `duplicate_of` | `signals/dedupe.ts` |
| Model says `investor_involvement=verified` (acting, not merely listed) **and** `specific_recent_event=true` (not a profile / directory / evergreen page) | `ai/analyze.ts` |
| Known profile/directory URLs (Crunchbase, Tracxn, LinkedIn, Wikipedia, ...) rejected before any fetch or AI call | `refresh/research.ts` |
| Quoted `evidence_excerpt` occurs verbatim in the fetched text (whitespace/case/quote-insensitive) | `ai/analyze.ts` |
| Model output must satisfy the zod schema; one retry with the validation error; then `needs_review` | `ai/analyze.ts` |

The model never decides dates, URLs, the score arithmetic, or what may be written to the database.

## 5. HTTP API

| Method & path | Auth | Purpose | Responses |
|---|---|---|---|
| `GET /api/cron/refresh` | `Authorization: Bearer $CRON_SECRET` (constant-time; fails closed if unset) | scheduled refresh | `202 {run_id,state}` · `200 already_running` · `401` · `500 {missing:[names]}` |
| `POST /api/refresh` | header `x-admin-passcode` = `$ADMIN_PASSCODE`; 8 wrong attempts/10 min/IP ⇒ lock | manual refresh | `202` · `200 already_running` · `429` (cooldown/lock, `Retry-After`) · `401` · `503` (passcode not configured) · `500` |
| `POST /api/refresh/continue` | `CRON_SECRET`; body `{run_id: uuid, chain: 1..50}` | internal hand-off | `202` · `400` · `401` |
| `GET /api/health` | none | `{ok, configured:{database,gemini,search,cron_secret,manual_refresh}}` — booleans only | `200` / `503` |

All responses under `/api/*` are `Cache-Control: no-store`. Error bodies name missing variables but never echo values.

## 6. Security summary

- Secrets only in server env; none are `NEXT_PUBLIC_*`; nothing is logged except error categories.
- **SSRF**: only http(s) on ports 80/443, no URL credentials; the socket's resolved address is validated inside the `lookup`
  hook (defeats DNS rebinding), every redirect hop re-validated, 10 s timeout, 1.5 MB cap, HTML/text only, robots.txt honoured.
- Prompt injection: page text is delimited and declared untrusted; since output is schema-constrained and scoring is
  deterministic, the worst a hostile page can do is skew one relevance number — it cannot write anywhere or change a date.
- Model text that reaches the database is single-lined, control-character-stripped and length-bounded; all SQL is parameterised.
- Security headers in `next.config.mjs` (no `script-src`: Next's inline hydration needs nonces — documented trade-off).
- Dependencies pinned exactly; `npm audit` reported 0 vulnerabilities at install time.
- Known gap: admin-passcode brute-force limiting is per-instance memory; the cost-relevant guard (cooldown) is in the DB.

## 7. Trade-offs worth defending

- **Direct Postgres instead of supabase-js.** One secret instead of three, column-level grants and `SET LOCAL ROLE` are
  available, and the same SQL runs on PGlite in tests — so the data-safety tests exercise the real migration. Cost: no
  PostgREST/Realtime (not needed) and a pooled-connection string to manage.
- **One search query per investor.** Keeps a full run at ~82 credits (free-tier friendly) at the cost of recall.
- **Quiet ≠ failed ≠ partial** are different states in the read model rather than one "no signal" bucket.
- **Evidence kept when rejected** (`signals.verification_status='rejected'` + reason): auditability and a cache that stops
  re-spending AI calls on URLs already judged.
- **Scoring is code, not a prompt**: reproducible, testable, explainable; the model only supplies a bounded relevance judgement.
