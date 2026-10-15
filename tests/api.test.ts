import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

// `after()` only exists inside a Next request scope; run the scheduled work on our own queue instead
// so tests can await it. Everything else (routes, auth, service, pipeline, DB) is the real code.
const h = vi.hoisted(() => ({ db: null as unknown as Db, deps: null as unknown, pending: [] as Promise<unknown>[] }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void h.pending.push(Promise.resolve().then(fn)) }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: () => h.db }));
vi.mock("@/lib/refresh/service", async (orig) => ({ ...(await orig<typeof import("@/lib/refresh/service")>()), productionDeps: () => h.deps }));

import { GET as cron } from "@/app/api/cron/refresh/route";
import { POST as continueRun } from "@/app/api/refresh/continue/route";
import { GET as health } from "@/app/api/health/route";
import { POST as manual } from "@/app/api/refresh/route";
import { checkAdmin, isCron, safeEqual } from "@/lib/auth";
import { missingEnv } from "@/lib/env";
import { handoffBase, MANUAL_COOLDOWN_MIN, MAX_CHAIN, triggerRefresh, work } from "@/lib/refresh/service";
import { startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";

const SECRET = "cron-secret-value-123";
const PASS = "let-me-in-please";
const ENV = { DATABASE_URL: "postgres://x", GEMINI_API_KEY: "g-key-AAA", TAVILY_API_KEY: "t-key-BBB", CRON_SECRET: SECRET, ADMIN_PASSCODE: PASS, RECENT_CHECK_HOURS: "0", COLD_CHECK_DAYS: "0", TAVILY_MONTHLY_BUDGET: "100000" };
const saved: Record<string, string | undefined> = {};

const req = (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
  new NextRequest(`https://vc.example${path}`, { method: init.method ?? "GET", headers: init.headers, body: init.body ? JSON.stringify(init.body) : undefined });
const bearer = (s = SECRET) => ({ authorization: `Bearer ${s}` });
const settle = async () => { while (h.pending.length) await Promise.all(h.pending.splice(0)); };
const runs = async () => (await h.db.query<{ status: string; trigger_type: string; investors_processed: number }>(`select status, trigger_type, investors_processed from runs order by started_at`)).rows;

beforeAll(async () => { h.db = await makeTestDb(); });
afterAll(() => h.db.close());
beforeEach(async () => {
  for (const k of Object.keys(ENV)) saved[k] = process.env[k];
  Object.assign(process.env, ENV);
  await h.db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs restart identity cascade");
  await h.db.query(`insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography) values
    ('vc_firm','alpha','Alpha','https://alpha.vc','Seed','{Logistics}','India'), ('vc_firm','beta','Beta','https://beta.vc','Seed','{Logistics}','India')`);
  const u = "https://news.example/alpha";
  h.deps = mkDeps(fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(3))], Beta: [] }), fakePages({ [u]: article("Alpha", daysAgo(3)) }), fakeAi());
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v); vi.unstubAllGlobals(); });

describe("auth primitives", () => {
  it("safeEqual compares correctly regardless of length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
  it("isCron fails closed when no secret is configured", () => {
    delete process.env.CRON_SECRET;
    expect(isCron(req("/x", { headers: bearer("") }))).toBe(false);
    expect(isCron(req("/x", { headers: { authorization: "Bearer undefined" } }))).toBe(false);
  });
  it("missingEnv reports names only", () => {
    delete process.env.TAVILY_API_KEY;
    expect(missingEnv(["TAVILY_API_KEY", "CRON_SECRET"])).toEqual(["TAVILY_API_KEY"]);
  });
});

describe("GET /api/cron/refresh (scheduled)", () => {
  it.each([
    ["no Authorization header", {}],
    ["wrong secret", bearer("nope")],
    ["wrong scheme", { authorization: `Basic ${SECRET}` }],
    ["secret as bare value", { authorization: SECRET }],
  ])("rejects %s with 401 and starts nothing", async (_n, headers) => {
    const res = await cron(req("/api/cron/refresh", { headers }));
    expect(res.status).toBe(401);
    expect(await runs()).toEqual([]);
  });

  it("is closed when CRON_SECRET is not configured, even for a request that guesses 'undefined'", async () => {
    delete process.env.CRON_SECRET;
    expect((await cron(req("/api/cron/refresh", { headers: bearer("undefined") }))).status).toBe(401);
  });

  it("reports missing configuration by NAME and never echoes any secret value", async () => {
    delete process.env.TAVILY_API_KEY;
    const res = await cron(req("/api/cron/refresh", { headers: bearer() }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "server_misconfigured", missing: ["TAVILY_API_KEY"] });
    for (const v of Object.values(ENV)) expect(text).not.toContain(v);
    expect(await runs()).toEqual([]);
  });

  it("authorised: accepts (202), then the scheduled work completes the run and updates the investors", async () => {
    const res = await cron(req("/api/cron/refresh", { headers: bearer() }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ state: "started" });
    expect((await runs())[0]).toMatchObject({ status: "running", trigger_type: "cron" }); // no success claimed yet
    await settle();
    expect((await runs())[0]).toMatchObject({ status: "succeeded", trigger_type: "cron", investors_processed: 2 });
    const { rows } = await h.db.query(`select follow_up_score from investors where firm_name='Alpha'`);
    expect((rows[0] as { follow_up_score: number }).follow_up_score).toBeGreaterThanOrEqual(70);
  });

  it("an overlapping scheduled trigger is a no-op that points at the active run", async () => {
    const first = await cron(req("/api/cron/refresh", { headers: bearer() }));
    const second = await cron(req("/api/cron/refresh", { headers: bearer() }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ state: "already_running", run_id: (await first.json()).run_id });
    await settle();
    expect(await runs()).toHaveLength(1);
  });
});

describe("POST /api/refresh (manual)", () => {
  const post = (headers: Record<string, string> = {}, ip = "1.1.1.1") => manual(req("/api/refresh", { method: "POST", headers: { "x-forwarded-for": ip, ...headers } }));

  it("is disabled (503) when ADMIN_PASSCODE is not configured", async () => {
    delete process.env.ADMIN_PASSCODE;
    const res = await post({ "x-admin-passcode": "anything" });
    expect(res.status).toBe(503);
    expect(await runs()).toEqual([]);
  });

  it("rejects a missing or wrong passcode and starts nothing", async () => {
    expect((await post()).status).toBe(401);
    expect((await post({ "x-admin-passcode": "wrong" })).status).toBe(401);
    expect(await runs()).toEqual([]);
  });

  it("the CRON secret is not a valid admin passcode, and the admin passcode is not a valid cron secret", async () => {
    expect((await post({ "x-admin-passcode": SECRET }, "2.2.2.2")).status).toBe(401);
    expect((await cron(req("/api/cron/refresh", { headers: bearer(PASS) }))).status).toBe(401);
  });

  it("locks an address out after repeated wrong passcodes, even if the right one follows", async () => {
    for (let i = 0; i < 8; i++) expect((await post({ "x-admin-passcode": `bad${i}` }, "9.9.9.9")).status).toBe(401);
    expect((await post({ "x-admin-passcode": PASS }, "9.9.9.9")).status).toBe(429);
    expect((await post({ "x-admin-passcode": PASS }, "8.8.8.8")).status).toBe(202); // other clients unaffected
    await settle();
  });

  it("authorised: starts a run; a duplicate click while it is active reuses it; after it finishes the cooldown applies", async () => {
    const a = await post({ "x-admin-passcode": PASS }, "3.3.3.3");
    expect(a.status).toBe(202);
    const aBody = await a.json();
    const dup = await post({ "x-admin-passcode": PASS }, "3.3.3.3");
    expect(dup.status).toBe(200);
    expect(await dup.json()).toEqual({ run_id: aBody.run_id, state: "already_running" });
    await settle();
    expect((await runs())).toHaveLength(1);
    const again = await post({ "x-admin-passcode": PASS }, "3.3.3.3");
    expect(again.status).toBe(429); // cost guard: one manual refresh per cooldown window
    expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(again.headers.get("retry-after"))).toBeLessThanOrEqual(MANUAL_COOLDOWN_MIN * 60);
    expect(await runs()).toHaveLength(1);
  });

  it("a scheduled run is never blocked by the manual cooldown", async () => {
    await post({ "x-admin-passcode": PASS }, "4.4.4.4");
    await settle();
    const res = await cron(req("/api/cron/refresh", { headers: bearer() }));
    expect(res.status).toBe(202);
    await settle();
    expect((await runs()).map((r) => r.trigger_type)).toEqual(["manual", "cron"]);
  });

  it("triggerRefresh: a stale active run is resumed by a manual trigger instead of being throttled", async () => {
    const rdb = asRefresh(h.db);
    const { run_id } = await startRun(rdb, "manual");
    await h.db.query(`update runs set heartbeat_at = now() - interval '1 hour' where id=$1`, [run_id]);
    expect(await triggerRefresh(rdb, "manual")).toEqual({ run_id, state: "resumed" });
  });
});

describe("hand-off between invocations (chunk chaining)", () => {
  it("POST /api/refresh/continue requires the cron secret and a valid body", async () => {
    const body = { run_id: "00000000-0000-4000-8000-000000000000", chain: 1 };
    expect((await continueRun(req("/api/refresh/continue", { method: "POST", body }))).status).toBe(401);
    expect((await continueRun(req("/api/refresh/continue", { method: "POST", headers: { "x-admin-passcode": PASS }, body }))).status).toBe(401);
    expect((await continueRun(req("/api/refresh/continue", { method: "POST", headers: bearer(), body: { run_id: "not-a-uuid", chain: 1 } }))).status).toBe(400);
    expect((await continueRun(req("/api/refresh/continue", { method: "POST", headers: bearer(), body: { ...body, chain: 999 } }))).status).toBe(400);
    expect((await continueRun(req("/api/refresh/continue", { method: "POST", headers: bearer(), body }))).status).toBe(202);
    await settle();
  });

  it("an unfinished chunk asks a new invocation to continue (authenticated); a finished one does not", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const rdb = asRefresh(h.db);
    const { run_id } = await startRun(rdb, "cron");

    await work(rdb, h.deps as never, run_id, "https://vc.example", 0, { maxItems: 1, concurrency: 1, batchEstimateMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://vc.example/api/refresh/continue");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init.body as string)).toEqual({ run_id, chain: 1 });
    expect((await runs())[0]!.status).toBe("running"); // not finished → no success claimed

    await work(rdb, h.deps as never, run_id, "https://vc.example", 1, { batchEstimateMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // finished → no further hand-off
    expect((await runs())[0]!.status).toBe("succeeded");
  });

  it("hands off to the public address even when the request arrived on the deployment's own (login-protected) one", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.APP_URL = "https://vc.example/";
    try {
      const rdb = asRefresh(h.db);
      const { run_id } = await startRun(rdb, "cron");
      await work(rdb, h.deps as never, run_id, "https://vc-abc123-team.vercel.app", 0, { maxItems: 1, concurrency: 1, batchEstimateMs: 0 });
      expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://vc.example/api/refresh/continue");
    } finally {
      delete process.env.APP_URL;
    }
    expect(handoffBase("https://deploy.vercel.app", {})).toBe("https://deploy.vercel.app"); // nothing configured: the request origin (local runs)
    expect(handoffBase("https://deploy.vercel.app", { VERCEL_PROJECT_PRODUCTION_URL: "vc.vercel.app" })).toBe("https://vc.vercel.app");
  });

  it("a lost hand-off is survivable and a runaway chain is capped", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("network down"); });
    vi.stubGlobal("fetch", fetchMock);
    const rdb = asRefresh(h.db);
    const { run_id } = await startRun(rdb, "cron");
    await expect(work(rdb, h.deps as never, run_id, "https://vc.example", 0, { maxItems: 1, concurrency: 1, batchEstimateMs: 0 })).resolves.toBeUndefined();
    await work(rdb, h.deps as never, run_id, "https://vc.example", MAX_CHAIN, { maxItems: 0, batchEstimateMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the capped call did not fetch
    // …and the stranded run is recoverable by the next trigger:
    await h.db.query(`update runs set heartbeat_at = now() - interval '1 hour' where id=$1`, [run_id]);
    expect(await triggerRefresh(rdb, "cron")).toEqual({ run_id, state: "resumed" });
  });
});

describe("GET /api/health", () => {
  it("reports configuration as booleans and leaks no values", async () => {
    delete process.env.TAVILY_API_KEY;
    const res = await health();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, configured: { database: true, gemini: true, ai_backup: false, search: false, cron_secret: true, manual_refresh: true, open_demo: false } });
    for (const v of Object.values(ENV)) expect(text).not.toContain(v);
  });
});
