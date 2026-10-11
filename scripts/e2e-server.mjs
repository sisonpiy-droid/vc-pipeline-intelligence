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
  GEMINI_API_KEY: "", // empty on purpose: the server must be unable to call either provider
  TAVILY_API_KEY: "",
  NEXT_TELEMETRY_DISABLED: "1",
};

rmSync(".data/e2e", { recursive: true, force: true });
execSync("npm run -s import && npm run -s dev:fixture", { stdio: "inherit", env });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", PORT], { stdio: "inherit", env });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { server.kill(); process.exit(0); });
server.on("exit", (code) => process.exit(code ?? 0));
