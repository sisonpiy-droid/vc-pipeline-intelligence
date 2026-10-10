# Demo script & video plan (≈ 6 minutes)

Pre-flight (do once, off camera): live deployment has run at least one **real** refresh (`/runs` shows it), `npm run check:live`
is green, and you know one investor whose signal you can open at the source URL.

| t | Show | Say |
|---|---|---|
| 0:00 | `/` Priority queue | "Vikram tracks 82 investors. The question is: who do I contact this week, on what evidence, and who should I leave alone?" Point at the four numbers — they add up to 82; **failed/partial are counted separately from quiet**. |
| 0:45 | Top card → source link | Open the evidence in a new tab: the article, the date on the page, the quoted sentence. "The date comes from the page, the quote is verified to exist verbatim — the AI doesn't get to make either up." |
| 1:30 | "Why this score" | Five bars: recency, relevance, evidence, fit, relationship. "Computed by fixed rules, not the model. A fresh but irrelevant article scores ~18, not 70." |
| 2:15 | `/investors/:id` | Profile with **unverified thesis flagged**, partner "none verified — none shown rather than guessed", relationship & notes **read-only**: "the refresh role can't even read this table column." |
| 3:00 | `/quiet` | The four kinds of quiet. Open a *failed* one: "we don't know — its previous score is untouched". "Failure is never reported as inactivity." |
| 3:45 | `/signals` | Provenance per card: event date vs retrieval date, confidence, duplicate-merge badge. Switch filter to *needs review*. |
| 4:30 | `/runs` | Run history, counters, coverage by source, audit log. Click **Refresh now**: show the passcode gate and the 10-minute cooldown message. |
| 5:15 | Data-safety proof (terminal) | `npm test -- refresh db.roles` → green; read out one test name: *"updates exactly the four signal columns; every other column … is byte-identical"*. |
| 5:45 | Close | Twice-weekly cron (`vercel.json`), chunked durable runs, Gemini-only AI, Supabase, what is **not** done (official-site crawling). |

**Recording tips.** Light mode for legibility; 1280×720; blur the address-bar tokens and never show `.env` or the Vercel
env-var page. If a live refresh is too slow to wait for, show the already-completed run rather than a spinner — do not
use `dev:fixture` data on camera (it is `[FIXTURE]`-labelled and local only).

**If something fails on camera:** say so — the product is designed to show failure honestly (failed refresh, partial run).
That is a feature to demonstrate, not hide.
