import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

const h = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: () => h.db }));

import { POST as edit } from "@/app/api/investors/[id]/founder/route";
import { FOUNDER_COLUMNS, FounderEditError, applyFounderEdit } from "@/lib/founder";
import { runChunk, startRun } from "@/lib/refresh/run";
import { SIGNAL_COLUMNS, asRefresh } from "@/lib/refresh/write";

const PASS = "founder-pass-xyz";
let id: string;
const saved: Record<string, string | undefined> = {};

const call = (body: unknown, opts: { pass?: string | null; ip?: string; id?: string } = {}) =>
  edit(
    new NextRequest("https://vc.example/api/investors/x/founder", {
      method: "POST",
      headers: { "x-forwarded-for": opts.ip ?? "7.7.7.7", ...(opts.pass === null ? {} : { "x-admin-passcode": opts.pass ?? PASS }), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: opts.id ?? id }) },
  );
const row = async () => (await h.db.query(`select * from investors where id=$1`, [id])).rows[0] as Record<string, unknown>;

beforeAll(async () => { h.db = await makeTestDb(); });
afterAll(() => h.db.close());
beforeEach(async () => {
  saved.ADMIN_PASSCODE = process.env.ADMIN_PASSCODE;
  process.env.ADMIN_PASSCODE = PASS;
  await h.db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs restart identity cascade");
  id = (await h.db.query<{ id: string }>(
    `insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography, follow_up_score, recommended_action, signal_summary, last_signal_date)
     values ('vc_firm', 'alpha', 'Alpha', 'https://alpha.vc', 'Seed', '{Logistics}', 'India', 80, 'reach_out_now', 'sig', '2026-10-01') returning id`,
  )).rows[0]!.id;
});
afterEach(() => { saved.ADMIN_PASSCODE === undefined ? delete process.env.ADMIN_PASSCODE : (process.env.ADMIN_PASSCODE = saved.ADMIN_PASSCODE); });

describe("applyFounderEdit", () => {
  it("changes exactly the requested founder fields; everything else, including every signal column, is untouched", async () => {
    const before = await row();
    const fields = await applyFounderEdit(h.db, id, { relationship_status: "contacted", last_contact_date: "2026-10-09", personal_notes: "Spoke to the partner.", add_contact: { date: "2026-10-09", channel: "call", note: "Intro call, positive." } });
    expect(fields.sort()).toEqual(["contact_history", "last_contact_date", "personal_notes", "relationship_status"]);
    const after = await row();
    expect(after).toMatchObject({ relationship_status: "contacted", personal_notes: "Spoke to the partner." });
    expect(after.contact_history).toEqual([{ date: "2026-10-09", channel: "call", note: "Intro call, positive." }]);
    for (const c of Object.keys(before).filter((k) => !FOUNDER_COLUMNS.includes(k as never) && k !== "updated_at")) expect(after[c]).toEqual(before[c]);
    for (const c of SIGNAL_COLUMNS) expect(after[c]).toEqual(before[c]);
  });

  it("appends to contact history rather than replacing it, and notes can be cleared", async () => {
    await applyFounderEdit(h.db, id, { add_contact: { note: "first" } });
    await applyFounderEdit(h.db, id, { add_contact: { note: "second", date: "2026-10-10" }, personal_notes: "x" });
    expect(((await row()).contact_history as { note: string }[]).map((e) => e.note)).toEqual(["first", "second"]);
    await applyFounderEdit(h.db, id, { personal_notes: null });
    expect((await row()).personal_notes).toBeNull();
  });

  it("the audit trail records which fields changed — never their contents", async () => {
    await applyFounderEdit(h.db, id, { personal_notes: "SECRET negotiating position", add_contact: { note: "CONFIDENTIAL term sheet talk" } });
    const log = (await h.db.query(`select event, detail, investor_id from audit_logs`)).rows[0] as { event: string; detail: unknown; investor_id: string };
    expect(log).toMatchObject({ event: "founder_edit", investor_id: id, detail: { fields: ["personal_notes", "contact_history"] } });
    expect(JSON.stringify(log)).not.toMatch(/SECRET|CONFIDENTIAL/);
  });

  it.each([
    ["unknown field (a signal column)", { follow_up_score: 100 }],
    ["unknown field (identity)", { firm_name: "Hacked" }],
    ["invalid status", { relationship_status: "best-friends" }],
    ["impossible date", { last_contact_date: "2026-02-31" }],
    ["empty edit", {}],
    ["empty contact note", { add_contact: { note: "   " } }],
    ["oversized notes", { personal_notes: "x".repeat(5001) }],
    ["extra key inside add_contact", { add_contact: { note: "ok", id: "x" } }],
  ])("rejects %s without writing anything", async (_n, body) => {
    const before = await row();
    await expect(applyFounderEdit(h.db, id, body)).rejects.toBeInstanceOf(FounderEditError);
    expect(await row()).toEqual(before);
    expect((await h.db.query(`select 1 from audit_logs`)).rowCount).toBe(0);
  });

  it("an unknown investor is not_found, and writes no audit row", async () => {
    await expect(applyFounderEdit(h.db, "00000000-0000-4000-8000-000000000000", { personal_notes: "x" })).rejects.toMatchObject({ code: "not_found" });
    expect((await h.db.query(`select 1 from audit_logs`)).rowCount).toBe(0);
  });
});

describe("POST /api/investors/:id/founder", () => {
  it("is disabled without ADMIN_PASSCODE; rejects missing/wrong passcodes; the CRON secret is not a passcode", async () => {
    delete process.env.ADMIN_PASSCODE;
    expect((await call({ personal_notes: "x" })).status).toBe(503);
    process.env.ADMIN_PASSCODE = PASS;
    expect((await call({ personal_notes: "x" }, { pass: null, ip: "1.1.1.1" })).status).toBe(401);
    expect((await call({ personal_notes: "x" }, { pass: "wrong", ip: "1.1.1.1" })).status).toBe(401);
    expect((await row()).personal_notes).toBeNull();
  });

  it("validates the id and body, 404s a missing investor, and saves on success", async () => {
    expect((await call({ personal_notes: "x" }, { id: "not-a-uuid" })).status).toBe(400);
    expect((await call({ follow_up_score: 1 })).status).toBe(400);
    expect((await call({ personal_notes: "x" }, { id: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    const ok = await call({ relationship_status: "awaiting_response" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ updated: ["relationship_status"] });
    expect((await row()).relationship_status).toBe("awaiting_response");
  });

  it("locks an address out after repeated wrong passcodes", async () => {
    for (let i = 0; i < 8; i++) expect((await call({ personal_notes: "x" }, { pass: `bad${i}`, ip: "9.9.9.9" })).status).toBe(401);
    expect((await call({ personal_notes: "x" }, { pass: PASS, ip: "9.9.9.9" })).status).toBe(429);
  });
});

describe("founder edits and refreshes protect each other", () => {
  const u = "https://news.example/alpha";
  const world = () => mkDeps(fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(3))] }), fakePages({ [u]: article("Alpha", daysAgo(3)) }), fakeAi());

  it("an edit survives a refresh; and the refresh role still cannot read or write these fields", async () => {
    await applyFounderEdit(h.db, id, { relationship_status: "in_conversation", personal_notes: "Warm — wants the deck.", add_contact: { note: "sent deck" } });
    const before = await row();
    const rdb = asRefresh(h.db);
    const { run_id } = await startRun(rdb, "manual");
    await runChunk(rdb, world(), run_id, { batchEstimateMs: 0 });
    const after = await row();
    for (const c of FOUNDER_COLUMNS) expect(after[c]).toEqual(before[c]);
    await expect(rdb.query(`select personal_notes from investors`)).rejects.toThrow(/permission denied/i);
    await expect(rdb.query(`update investors set relationship_status='passed'`)).rejects.toThrow(/permission denied/i);
  });

  it("the CRM effect is real: marking 'awaiting response' after a recent contact makes the next refresh recommend WAITING, not chasing", async () => {
    const rdb = asRefresh(h.db);
    const run = async () => { const { run_id } = await startRun(rdb, "manual"); await runChunk(rdb, { ...world(), now: () => new Date(`${daysAgo(0)}T12:00:00Z`) }, run_id, { batchEstimateMs: 0 }); };
    await run();
    expect((await row()).recommended_action).toBe("reach_out_now");
    await applyFounderEdit(h.db, id, { relationship_status: "awaiting_response", last_contact_date: daysAgo(2) });
    await run();
    expect((await row()).recommended_action).toBe("wait_for_response");
    await applyFounderEdit(h.db, id, { relationship_status: "passed" });
    await run();
    expect((await row()).recommended_action).toBe("no_action");
  });
});
