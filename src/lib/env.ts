/** Names (never values) of required environment variables that are not set. */
export function missingEnv(names: string[]): string[] {
  return names.filter((n) => !process.env[n]?.trim());
}

/** What a full refresh needs. ADMIN_PASSCODE is only needed for the manual button, so it is checked there. */
export const REFRESH_ENV = ["DATABASE_URL", "GEMINI_API_KEY", "TAVILY_API_KEY", "CRON_SECRET"];
