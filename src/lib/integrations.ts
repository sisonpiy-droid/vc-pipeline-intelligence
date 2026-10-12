/**
 * Which outside services this deployment has switched on, by NAME only. It reads whether an environment variable is set; it never
 * returns, logs or renders a value, so it is safe to show on a public page.
 */
export type IntegrationState = "configured" | "not_set" | "open";
export interface Integration { key: string; name: string; state: IntegrationState; note: string }

const has = (env: Record<string, string | undefined>, ...keys: string[]) => keys.every((k) => Boolean(env[k]?.trim()));

export function integrations(env: Record<string, string | undefined> = process.env): Integration[] {
  const on = (ok: boolean): IntegrationState => (ok ? "configured" : "not_set");
  return [
    { key: "database", name: "Database", state: on(has(env, "DATABASE_URL")), note: "Supabase Postgres holds investors, signals and runs." },
    { key: "gemini", name: "Gemini", state: on(has(env, "GEMINI_API_KEY")), note: "Gemini Flash reads and judges the evidence." },
    { key: "search", name: "Search", state: on(has(env, "TAVILY_API_KEY")), note: "Tavily finds public pages about each investor." },
    { key: "mail", name: "Mail drafts", state: on(has(env, "FOUNDER_NAME", "STARTUP_BRIEF")), note: "Fills your name and pitch into each draft. It never sends mail." },
    { key: "calendly", name: "Calendly", state: on(/^https:\/\//i.test(env.CALENDLY_URL?.trim() ?? "")), note: "The meeting link added to every draft." },
    { key: "telegram", name: "Telegram", state: on(has(env, "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID")), note: "The daily report to your phone." },
    { key: "cron", name: "Cron", state: on(has(env, "CRON_SECRET")), note: "Starts the Monday and Thursday refresh." },
    { key: "admin", name: "Admin", state: env.DEMO_OPEN === "1" ? "open" : on(has(env, "ADMIN_PASSCODE")), note: env.DEMO_OPEN === "1" ? "Open demo mode: no passcode needed." : "Passcode for manual refresh and edits." },
  ];
}
