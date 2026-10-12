import { describe, expect, it } from "vitest";
import { integrations } from "@/lib/integrations";

describe("integrations: names and states only, never values", () => {
  const state = (env: Record<string, string>) => Object.fromEntries(integrations(env).map((i) => [i.key, i.state]));

  it("is 'not set' for everything on an empty environment, and lists Calendly (not WhatsApp)", () => {
    const s = state({});
    expect(Object.values(s).every((v) => v === "not_set")).toBe(true);
    expect(Object.keys(s)).toEqual(["database", "gemini", "search", "mail", "calendly", "telegram", "cron", "admin"]);
  });

  it("switches each one on from its own variables", () => {
    const s = state({ DATABASE_URL: "postgres://x", GEMINI_API_KEY: "k", TAVILY_API_KEY: "k", FOUNDER_NAME: "A", STARTUP_BRIEF: "B", CALENDLY_URL: "https://calendly.com/x", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1", CRON_SECRET: "c", ADMIN_PASSCODE: "p" });
    expect(Object.values(s).every((v) => v === "configured")).toBe(true);
  });

  it("needs both Telegram variables, an https Calendly link, and shows open demo mode for Admin", () => {
    expect(state({ TELEGRAM_BOT_TOKEN: "t" }).telegram).toBe("not_set");
    expect(state({ CALENDLY_URL: "javascript:alert(1)" }).calendly).toBe("not_set");
    expect(state({ DEMO_OPEN: "1" }).admin).toBe("open");
  });

  it("never returns a secret value anywhere in its output", () => {
    const out = JSON.stringify(integrations({ DATABASE_URL: "postgres://user:SECRETPW@host/db", GEMINI_API_KEY: "SECRETKEY", CRON_SECRET: "SECRETCRON", ADMIN_PASSCODE: "SECRETPASS", CALENDLY_URL: "https://calendly.com/SECRETPATH" }));
    expect(out).not.toMatch(/SECRET/);
  });
});
