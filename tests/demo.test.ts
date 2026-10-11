import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

const h = vi.hoisted(() => ({ db: null as unknown as Db, deps: null as unknown, pending: [] as Promise<unknown>[] }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void h.pending.push(Promise.resolve().then(fn)) }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: () => h.db }));
vi.mock("@/lib/refresh/service", async (orig) => ({ ...(await orig<typeof import("@/lib/refresh/service")>()), productionDeps: () => h.deps }));

import { POST as founder } from "@/app/api/investors/[id]/founder/route";
import { GET as health } from "@/app/api/health/route";
import { POST as manual } from "@/app/api/refresh/route";
import { isOpenDemo } from "@/lib/demo";

const ENV = { DATABASE_URL: "x", GEMINI_API_KEY: "g", TAVILY_API_KEY: "t", CRON_SECRET: "c", RECENT_CHECK_HOURS: "0", COLD_CHECK_DAYS: "0", TAVILY_MONTHLY_BUDGET: "100000" };
const KEYS = [...Object.keys(ENV), "ADMIN_PASSCODE", "DEMO_OPEN"];
const saved: Record<string, string | undefined> = {};
let id: string;

const refresh = (headers: Record<string, string> = {}, ip = "5.5.5.5") =>
  manual(new NextRequest("https://vc.example/api/refresh", { method: "POST", headers: { "x-forwarded-for": ip, ...headers } }));
const edit = (body: unknown, headers: Record<string, string> = {}, ip = "6.6.6.6") =>
  founder(new NextRequest("https://vc.example/x", { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const settle = async () => { while (h.pending.length) await Promise.all(h.pending.splice(0)); };

beforeAll(async () => { h.db = await makeTestDb(); });
afterAll(() => h.db.close());
beforeEach(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  Object.assign(process.env, ENV);
  delete process.env.DEMO_OPEN;
  process.env.ADMIN_PASSCODE = "real-passcode";
  await h.db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs restart identity cascade");
  id = (await h.db.query<{ id: string }>(`insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography) values ('vc_firm','alpha','Alpha','https://alpha.vc','Seed','{Logistics}','India') returning id`)).rows[0]!.id;
  const u = "https://news.example/a";
  h.deps = mkDeps(fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(2))] }), fakePages({ [u]: article("Alpha", daysAgo(2)) }), fakeAi());
});
afterEach(() => { for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]); });

describe("open demo mode is OFF by default", () => {
  it("manual refresh and founder edit still require the passcode", async () => {
    expect(isOpenDemo()).toBe(false);
    expect((await refresh()).status).toBe(401);
    expect((await edit({ personal_notes: "x" })).status).toBe(401);
    expect((await h.db.query(`select 1 from runs`)).rowCount).toBe(0);
    expect(((await h.db.query(`select personal_notes n from investors`)).rows[0] as { n: string | null }).n).toBeNull();
  });
  it("any value other than exactly '1' keeps it closed", async () => {
    for (const v of ["0", "true", "yes", ""]) {
      process.env.DEMO_OPEN = v;
      expect((await refresh()).status).toBe(401);
    }
  });
});

describe("DEMO_OPEN=1", () => {
  beforeEach(() => { process.env.DEMO_OPEN = "1"; delete process.env.ADMIN_PASSCODE; });

  it("manual refresh works with no passcode and no ADMIN_PASSCODE configured", async () => {
    const res = await refresh();
    expect(res.status).toBe(202);
    await settle();
    expect(((await h.db.query(`select status from runs`)).rows[0] as { status: string }).status).toBe("succeeded");
  });

  it("but the cost guards still apply: a second manual refresh is throttled, and a stray passcode header is irrelevant", async () => {
    expect((await refresh({ "x-admin-passcode": "anything" })).status).toBe(202);
    await settle();
    const again = await refresh();
    expect(again.status).toBe(429);
    expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("founder edit works with no passcode, is still strictly validated, and is still audited by field name", async () => {
    expect((await edit({ relationship_status: "contacted", personal_notes: "demo note" })).status).toBe(200);
    expect(await h.db.query(`select relationship_status r, personal_notes n from investors`).then((r) => r.rows[0])).toEqual({ r: "contacted", n: "demo note" });
    expect((await edit({ follow_up_score: 100 })).status).toBe(400); // signal columns remain untouchable
    expect((await edit({ firm_name: "x" })).status).toBe(400);
    const log = (await h.db.query(`select detail from audit_logs where event='founder_edit'`)).rows;
    expect(JSON.stringify(log)).not.toMatch(/demo note/);
  });

  it("health reports the mode, so it is visible rather than silent", async () => {
    const body = await (await health()).json();
    expect(body.configured).toMatchObject({ open_demo: true, manual_refresh: true });
  });

  it("switching it off restores the passcode requirement immediately", async () => {
    expect((await refresh()).status).toBe(202);
    await settle();
    process.env.DEMO_OPEN = "0";
    process.env.ADMIN_PASSCODE = "real-passcode";
    expect((await edit({ personal_notes: "x" })).status).toBe(401);
    expect((await edit({ personal_notes: "x" }, { "x-admin-passcode": "real-passcode" })).status).toBe(200);
  });
});
