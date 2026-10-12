/**
 * The API reference, as data. tests/apidocs.test.ts fails if a route exists without an entry here (or the reverse), so
 * this page cannot drift from the code. Every endpoint is server-side only; there is no browser-held secret.
 */
export interface Endpoint {
  method: "GET" | "POST" | "DELETE";
  /** Next.js route path as it appears under src/app/api (dynamic segments in [brackets]). */
  path: string;
  summary: string;
  auth: { kind: "none" | "cron_secret" | "admin_passcode"; detail: string };
  request?: string;
  responses: { status: number; meaning: string }[];
  limits: string;
  example?: string;
}

export const ENDPOINTS: Endpoint[] = [
  {
    method: "GET", path: "/api/health",
    summary: "Liveness and configuration presence. Booleans only: never a value, never a key.",
    auth: { kind: "none", detail: "Public. Reveals only whether things are configured." },
    responses: [{ status: 200, meaning: "{ ok: true, configured: { database, gemini, search, cron_secret, manual_refresh, open_demo } }" }, { status: 503, meaning: "The database is unreachable (ok: false)." }],
    limits: "None; one trivial query.",
    example: "curl https://vc-pipeline-intelligence.vercel.app/api/health",
  },
  {
    method: "GET", path: "/api/cron/refresh",
    summary: "The twice-weekly scheduled refresh (Vercel Cron: Monday and Thursday 04:00 UTC = 09:30 IST). Plans which investors are worth searching, creates a durable run, and returns at once; the work continues in the background in chunks.",
    auth: { kind: "cron_secret", detail: "Authorization: Bearer $CRON_SECRET (Vercel Cron sends it automatically). Fails closed if the secret is not set." },
    responses: [
      { status: 202, meaning: "A run started or resumed: { run_id, state }." },
      { status: 200, meaning: "state is already_running (overlap guard) or nothing_due (everyone was checked recently; zero credits spent)." },
      { status: 401, meaning: "Missing or wrong secret." },
      { status: 500, meaning: "Required environment variables are missing (names listed, never values)." },
    ],
    limits: "At most one active run (a unique index in the database). Function time limit 300 s; longer runs hand off to /api/refresh/continue.",
    example: 'curl -H "Authorization: Bearer $CRON_SECRET" https://vc-pipeline-intelligence.vercel.app/api/cron/refresh',
  },
  {
    method: "POST", path: "/api/refresh",
    summary: "Manual refresh from the dashboard button. Same pipeline as the cron, plus an opt-in LinkedIn search.",
    auth: { kind: "admin_passcode", detail: "Header x-admin-passcode. Not required when the deployment runs in open demo mode (DEMO_OPEN=1); disabled with 503 if neither is configured." },
    request: '{ "linkedin": true }   (optional; roughly doubles the search credits this run uses)',
    responses: [
      { status: 202, meaning: "Started: { run_id, state }." },
      { status: 200, meaning: "already_running or nothing_due." },
      { status: 401, meaning: "Wrong passcode (answered after a 400 ms delay)." },
      { status: 429, meaning: "Too many wrong passcodes (8 per 10 minutes per IP), or the manual cooldown is active (Retry-After header)." },
      { status: 503, meaning: "Manual refresh is not enabled." },
    ],
    limits: "One manual run per 10 minutes, shared by everyone; monthly search-credit budget enforced by the planner (default 900); investors checked in the last 36 hours are skipped.",
    example: 'curl -X POST -H "x-admin-passcode: …" https://…/api/refresh',
  },
  {
    method: "POST", path: "/api/refresh/continue",
    summary: "Internal hand-off: continues a run that did not fit in one invocation. Called by the app itself, not by people.",
    auth: { kind: "cron_secret", detail: "Authorization: Bearer $CRON_SECRET." },
    request: '{ "run_id": "<uuid>", "chain": 1..50 }',
    responses: [{ status: 202, meaning: "{ accepted: true }; the work runs after the response." }, { status: 400, meaning: "Body failed validation." }, { status: 401, meaning: "Missing or wrong secret." }],
    limits: "Chain depth capped at 20. If a hand-off is lost, the run's heartbeat goes stale and the next cron or manual trigger resumes it.",
  },
  {
    method: "POST", path: "/api/rescore",
    summary: "Re-scores every checked investor from the evidence already stored. No search credits, no model calls. Applies the passage of time and any scoring-rule change.",
    auth: { kind: "cron_secret", detail: "Authorization: Bearer $CRON_SECRET." },
    responses: [{ status: 200, meaning: "{ investors, changed, action_changes, angles, skipped }" }, { status: 409, meaning: "A refresh is in progress." }, { status: 401, meaning: "Missing or wrong secret." }],
    limits: "Writes only the four signal-derived columns, as the restricted refresh role. Never-checked investors are not scored.",
    example: 'curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://…/api/rescore',
  },
  {
    method: "POST", path: "/api/investors/[id]/founder",
    summary: "Edits the founder-owned fields of one investor: relationship status, last contact date, one appended contact-history entry, personal notes. The mirror image of the refresh boundary.",
    auth: { kind: "admin_passcode", detail: "Header x-admin-passcode (same lockout as /api/refresh); not required in open demo mode." },
    request: '{ "relationship_status"?, "last_contact_date"?: "YYYY-MM-DD"|null, "add_contact"?: { date?, channel?, note }, "personal_notes"?: string|null }   (strict: any other key is rejected)',
    responses: [{ status: 200, meaning: "{ updated: [field names] }" }, { status: 400, meaning: "Validation failed (unknown key, bad date, empty edit, bad id)." }, { status: 401, meaning: "Wrong passcode." }, { status: 404, meaning: "No such investor." }, { status: 429, meaning: "Too many wrong passcodes." }, { status: 503, meaning: "Editing is not enabled." }],
    limits: "Cannot write any signal-derived, profile or identity column. Audited by field name only, never by content. History is append-only.",
  },
  {
    method: "POST", path: "/api/demo/reset",
    summary: "Demo mode: deletes the synthetic demo investors (and only those, with the runs and audit lines they produced) and recreates the five labelled Piyush accounts. Real investors, signals, runs, notes and contact history are never touched.",
    auth: { kind: "admin_passcode", detail: "Header x-admin-passcode; not required in open demo mode." },
    responses: [{ status: 200, meaning: "{ removed, created, demo: true }" }, { status: 401, meaning: "Wrong passcode." }, { status: 429, meaning: "Too many wrong passcodes." }, { status: 503, meaning: "Not enabled on this server." }],
    limits: "Every statement is scoped by the is_demo flag. No search credits or model calls.",
  },
  {
    method: "POST", path: "/api/demo/simulate",
    summary: "Demo mode: a simulated refresh. Re-scores the demo investors from their stored synthetic evidence and records a run labelled as simulated.",
    auth: { kind: "admin_passcode", detail: "Header x-admin-passcode; not required in open demo mode." },
    responses: [{ status: 200, meaning: "{ run_id, investors, changed, action_changes, simulated: true }" }, { status: 401, meaning: "Wrong passcode." }, { status: 429, meaning: "Too many wrong passcodes." }, { status: 503, meaning: "Not enabled on this server." }],
    limits: "Writes only the four signal columns, as the restricted refresh role, and only on demo investors. No search credits or model calls.",
  },
  {
    method: "GET", path: "/api/palette",
    summary: "Investor names, scores and actions for the Ctrl+K search palette: the same facts the pipeline page shows.",
    auth: { kind: "none", detail: "Public read of dashboard facts; never notes or contact history." },
    responses: [{ status: 200, meaning: "{ investors: [{ id, name, type, score, action }] }" }, { status: 503, meaning: "Database unavailable." }],
    limits: "Not cached: the list depends on whether the browser is in demo mode (a cookie).",
  },
  {
    method: "POST", path: "/api/startups",
    summary: "Creates a startup and has Gemini Flash draft its scoring rubric. Every number the model returns is clamped by code; if Gemini fails, a plain default rubric built from the profile is stored and labelled as such. No search runs.",
    auth: { kind: "admin_passcode", detail: "Header x-admin-passcode (same lockout as /api/refresh); not required in open demo mode." },
    request: '{ "name", "pitch", "sector", "stage": "pre_seed"|"seed"|"series_a"|"series_b_plus", "geography"?, "round_size"?, "ask"? }',
    responses: [{ status: 201, meaning: "{ slug, rubric_source: gemini|default, note }" }, { status: 400, meaning: "Validation failed (issues listed per field)." }, { status: 401, meaning: "Wrong passcode." }, { status: 409, meaning: "The limit of 25 startups is reached." }, { status: 429, meaning: "Too many wrong passcodes." }, { status: 503, meaning: "Not enabled." }],
    limits: "One Gemini call. Writes only the startup tables; never investors, signals or the founder's own scores.",
  },
  {
    method: "POST", path: "/api/startups/[slug]/evaluate",
    summary: "Judges the evidence already stored (verified signals from the last 30 days) against this startup with Gemini, then scores every searched investor with the startup's rubric. Resumable and cached: judged signals are not asked again.",
    auth: { kind: "admin_passcode", detail: "Header x-admin-passcode (same lockout as /api/refresh); not required in open demo mode." },
    responses: [{ status: 202, meaning: "Started; progress is in the startup's workflow steps." }, { status: 200, meaning: "{ state: already_running }" }, { status: 404, meaning: "No such startup." }, { status: 401, meaning: "Wrong passcode." }],
    limits: "No search and no Tavily credit. At most 80 Gemini calls and 4 minutes per evaluation; whatever is not finished is reported as not judged, never guessed.",
  },
  {
    method: "POST", path: "/api/startups/[slug]/rubric",
    summary: "Saves an edited rubric, or asks Gemini for a new one with { action: 'regenerate' }. Numbers and keyword edits re-score at once from cached judgements; changing what a topic class means clears the judgements so the next evaluation asks Gemini again.",
    auth: { kind: "admin_passcode", detail: "Header x-admin-passcode (same lockout as /api/refresh); not required in open demo mode." },
    request: '{ "rubric": { ... } }  or  { "action": "regenerate" }',
    responses: [{ status: 200, meaning: "{ rubric_source, rescored, needs_evaluation }" }, { status: 502, meaning: "Gemini could not write a new rubric; the current one is kept." }, { status: 400, meaning: "Neither a rubric nor an action." }, { status: 404, meaning: "No such startup." }, { status: 401, meaning: "Wrong passcode." }],
    limits: "Whatever is submitted is clamped by code before it can reach the scoring arithmetic (weights total 100, thresholds ordered, caps non-increasing).",
  },
  {
    method: "DELETE", path: "/api/startups/[slug]",
    summary: "Deletes a startup with its rubric, judgements and scores. Shared investors and evidence are untouched.",
    auth: { kind: "admin_passcode", detail: "Header x-admin-passcode (same lockout as /api/refresh); not required in open demo mode." },
    responses: [{ status: 200, meaning: "{ deleted: 1 }" }, { status: 404, meaning: "No such startup." }, { status: 401, meaning: "Wrong passcode." }],
    limits: "Only the startup's own rows.",
  },
];
