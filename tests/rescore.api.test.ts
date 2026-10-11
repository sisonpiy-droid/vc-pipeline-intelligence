import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { runChunk, startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";
import { article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

const h = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: () => h.db }));
import { POST } from "@/app/api/rescore/route";

const call = (auth?: string) => POST(new NextRequest("https://vc.example/api/rescore", { method: "POST", headers: auth ? { authorization: auth } : {} }));

beforeAll(async () => { h.db = await makeTestDb(); });
afterAll(() => h.db.close());
beforeEach(async () => {
  process.env.CRON_SECRET = "s3cret";
  await h.db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs, score_history restart identity cascade");
  await h.db.query(`insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography) values ('vc_firm', 'alpha', 'Alpha', 'https://alpha.vc', 'Seed', '{Logistics}', 'India')`);
  const u = "https://news.example/a";
  const { run_id } = await startRun(asRefresh(h.db), "manual");
  await runChunk(asRefresh(h.db), mkDeps(fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(2))] }), fakePages({ [u]: article("Alpha", daysAgo(2)) }), fakeAi()), run_id, { batchEstimateMs: 0 });
});

describe("POST /api/rescore", () => {
  it("rejects a missing or wrong secret and does nothing", async () => {
    const before = (await h.db.query(`select count(*)::int n from score_history`)).rows[0];
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await h.db.query(`select count(*)::int n from score_history`)).rows[0]).toEqual(before);
  });

  it("with the secret, re-scores from stored evidence and reports what it did", async () => {
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ investors: 1, skipped: 0 });
    expect((await h.db.query(`select count(*)::int n from score_history where source = 'rescore'`)).rows[0]).toEqual({ n: 1 });
  });

  it("refuses to run while a refresh is in progress", async () => {
    await h.db.query(`insert into runs (trigger_type, status) values ('manual', 'running')`);
    expect((await call("Bearer s3cret")).status).toBe(409);
  });
});
