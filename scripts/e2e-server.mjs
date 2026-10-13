// Starts the app for the browser tests: a fresh throwaway database seeded by the real pipeline over canned providers
// (scripts/dev-fixture.ts), then the production server. Nothing here can reach Supabase, Tavily or Gemini.
import { execSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";

const PORT = process.env.E2E_PORT ?? "3222";
const env = {
  ...process.env,
  DATABASE_URL: "pglite://.data/e2e",
  DEMO_OPEN: "1",
  CRON_SECRET: "e2e-secret",
  GEMINI_API_KEY: "", // empty on purpose: the server must be unable to call any provider, including the backups below
  GEMINI_API_KEY_2: "",
  OPENROUTER_API_KEY: "",
  TAVILY_API_KEY: "",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_CHAT_ID: "",
  NEXT_TELEMETRY_DISABLED: "1",
  NEWS_OFFLINE: "1", // the News page reads canned feeds, never the internet
};

rmSync(".data/e2e", { recursive: true, force: true });
execSync("npm run -s import && npm run -s dev:fixture && npm run -s demo:seed", { stdio: "inherit", env });
// Optional, for looking at the Investor database page on real lists: E2E_DIRECTORY_DIR=<folder with the spreadsheets>. It loads them into
// this throwaway local database only (DATABASE_URL above is pglite); tsx is run without --env-file so no real connection string is read.
if (process.env.E2E_DIRECTORY_DIR) execSync(`npx tsx scripts/import-directory.ts --dir "${process.env.E2E_DIRECTORY_DIR}"`, { stdio: "inherit", env });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", process.env.E2E_DEV ? "dev" : "start", "-p", PORT], { stdio: "inherit", env });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { server.kill(); process.exit(0); });
server.on("exit", (code) => process.exit(code ?? 0));
