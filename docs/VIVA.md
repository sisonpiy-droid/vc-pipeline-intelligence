# Viva preparation — architecture and trade-offs

**Q. How do you guarantee the AI refresh never overwrites the founder's notes?**
Three independent layers. (1) The only investor write is `applySignalUpdate`: a strict zod schema over exactly four
fields; SQL is built from a constant column list, never from the incoming object. (2) The refresh runs as a Postgres role
`vc_refresh` with `UPDATE` on those four columns only and no `SELECT` on `personal_notes` / `contact_history`, so even a
careless `select *` fails. (3) Tests snapshot the whole row before and after a refresh — success, repeats, partial
failure, hostile model output — and assert equality outside the four columns, including `updated_at`.

**Q. Why not trust Gemini's dates / links / scores?**
Models hallucinate. Dates come from page metadata (JSON-LD, Open Graph) and contradictions reject the item; URLs come from
the search provider and are canonicalised; the score is arithmetic in code. Gemini supplies bounded judgements — classification,
relevance 0–100, a one-sentence summary — and its quoted evidence must appear **verbatim** in the page we fetched, else it is rejected.

**Q. How does it handle 82 investors on a serverless platform with a 300 s limit?**
A run is data: a `runs` row and one `run_items` row per investor. Each invocation claims 3 items at a time (`FOR UPDATE
SKIP LOCKED`) until its time budget ends, then hands off to a fresh invocation via an authenticated `POST`. Killed
function ⇒ items reclaimed after 5 min; lost hand-off ⇒ heartbeat goes stale and the next trigger resumes the *same* run.
One active run is enforced by a partial unique index.

**Q. What stops it saying "this investor is quiet" when the search simply failed?**
`deriveState` has separate outcomes: failed, partial coverage, not-checked, stale, and *complete* quiet. A failed item
doesn't write any investor column (the previous score stays) and the UI says "activity unknown — not quiet".

**Q. What is the biggest weakness?**
Recall. One Tavily query per investor, no independent crawl of official portfolio/news pages. Mitigation is honest
labelling: partial coverage is shown, and "no signal" is only asserted when every source answered. Next step would be a
per-firm RSS/sitemap fetch with snapshot diffing.

**Q. Why Postgres directly instead of supabase-js?**
Fewer secrets (one), access to roles/grants/`SET LOCAL ROLE`, and the same SQL runs in PGlite for tests — so the safety
tests exercise the real migration. RLS is still enabled with no public policies, so Supabase's auto API exposes nothing.

**Q. Why twice-weekly on Mondays and Thursdays?**
Vercel Hobby crons run at most daily with up to ~1 h jitter; Mon+Thu gives even 3/4-day spacing and keeps free-tier search
credits (~710/month for 82 investors) inside ~1,000. Schedule lives in `vercel.json` and a test keeps the dashboard's
"next run" in step with it.

**Q. What did you change from the brief's suggested weights, and why?**
Weights unchanged (30/30/20/15/5). I added a relevance gate on recency/evidence and a relevance floor of 40 because the
literal weights score a fresh irrelevant article 72; with the gate it is 18. Thresholds 75/55 come from a score grid in
`docs/SCORING.md` (the first version used 70/50 and let "adjacent" signals through).

**Q. Security?**
Constant-time secret comparison, fail-closed cron auth, input validation (zod), SSRF-guarded fetcher validating the
*connected* address (DNS-rebinding safe) with per-hop redirect checks and robots.txt, passcode lockout + DB cooldown on the
manual trigger, no secrets client-side or in logs, RLS on, exact-pinned dependencies. Known gap: lockout counter is
per-instance memory; strict CSP needs nonces (documented).

**Q. What is *not* verified yet?** (answer honestly — see the checklist)
Everything below has been exercised on the deployed app: Supabase, Tavily, Gemini, the write boundary, the chat, the news
feeds and the mail drafts. Two things have not run yet because they are scheduled: the first cron refresh that actually
searches for new signals (Thursday 15 October, 09:30 IST) and the first scheduled Telegram digest
(13 October, about 11:00 IST). The Telegram bot itself is connected: a test message was delivered.

**Q. Did you consider an MCP server?**
Yes, and I left it out on purpose. The brief needs a scheduled job and a database, not an agent interface. An MCP server
would be a second way into the data, and the strongest guarantee here is that a refresh writes four columns and never
touches notes or contact history. The chat assistant is built so it cannot see private data either. Later, a read-only
MCP layer over the public pages would be reasonable; it is not a requirement today.

**Q. Where is the private contact data, and who can see it?**
Imported into one locked table (`investor_directory`): row-level security on, no grants to any role the app uses for
pages. The only code that reads it returns aggregate counts for the Investor database page. No names or emails are rendered
anywhere, and the chat assistant's context never includes it.

**Q. The email draft: does the app send anything?**
No. It builds the text (greeting, why this investor, what we do, one ask with the Calendly link) and opens it in the
founder's own mail app or Gmail. Marking an investor Contacted is a founder action with one-click undo, because opening a
draft is not proof it was sent. A mail link can only carry plain text, so the preview and the Copy button give a real link.

**Q. What happens when Gemini's free quota runs out? Is there a fallback?**
Yes, and it is the same model. The AI client (`src/lib/ai/chain.ts`) tries Google Gemini Flash with the main key, then an
optional second Google key (a different Google project has its own free quota), then the same Gemini Flash model through
OpenRouter. It never switches to a different model, a blocked prompt is not retried elsewhere, and a route that just hit its
quota is skipped for a minute so a long refresh does not stall. The backup is paid per use (cents for a full run) and only
runs after Google has failed; every use is logged and the API page's Integrations panel shows whether a backup is set up.
Without any backup the behaviour is as before: a typed error, the investor keeps its previous score, and the chat answers
with a plain summary of the same data.
