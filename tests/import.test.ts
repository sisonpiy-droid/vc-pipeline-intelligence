import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { importInvestors, parseWorkbookRows, type InvestorRecord } from "@/lib/investors/import";
import { readWorkbook } from "@/lib/investors/workbook";
import { makeTestDb } from "./helpers/testDb";

const WORKBOOK = "data/india_vc_and_angel_profiles.xlsx";
let records: InvestorRecord[];
let issues: ReturnType<typeof parseWorkbookRows>["issues"];

beforeAll(async () => {
  const { vc, angels } = await readWorkbook(WORKBOOK);
  ({ records, issues } = parseWorkbookRows(vc, angels));
});

describe("workbook parsing (real file)", () => {
  it("yields all 50 VC firms and 32 angels, none dropped as duplicates or invalid", () => {
    expect(records.filter((r) => r.entity_type !== "angel")).toHaveLength(50);
    expect(records.filter((r) => r.entity_type === "angel")).toHaveLength(32);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("trims stray whitespace in names and flags it", () => {
    const pi = records.find((r) => r.name_key === "pi ventures")!;
    expect(pi.firm_name).toBe("pi Ventures");
    expect(pi.data_flags).toContain("name_cleaned");
  });

  it("splits combined names into primary + aliases taken from the source", () => {
    const artha = records.find((r) => r.name_key === "artha venture fund")!;
    expect(artha.aliases).toEqual(["Artha Group"]);
    expect(records.find((r) => r.firm_name === "Matrix Partners India")!.aliases).toEqual(["Z47"]);
  });

  it("does not fabricate partner names, contact info or signal data", () => {
    for (const r of records) {
      expect(r.partner_name).toBeNull();
      expect(r.last_contact_date).toBeNull();
      expect(r.contact_history).toEqual([]);
      expect(r.personal_notes).toBeNull();
      expect(r).not.toHaveProperty("follow_up_score");
      expect(r).not.toHaveProperty("signal_summary");
    }
  });

  it("flags uncertain fields rather than silently trusting them", () => {
    const blume = records.find((r) => r.name_key === "blume ventures")!;
    expect(blume.geography).toBe("India");
    expect(blume.data_flags).toEqual(expect.arrayContaining(["geography_unconfirmed", "thesis_unverified", "partner_unknown", "relationship_status_placeholder"]));
    expect(blume.verification_status).toBe("source_reviewed"); // "Official portfolio page reviewed"
    expect(records.find((r) => r.name_key === "jsw ventures")!.verification_status).toBe("source_reviewed");
    expect(records.find((r) => r.name_key === "3one4 capital")!.verification_status).toBe("unverified"); // "Verify current thesis"
  });

  it("distinguishes entity types, marking inferred ones as heuristic", () => {
    const heuristic = records.filter((r) => r.entity_type_source === "heuristic");
    expect(heuristic.length).toBeGreaterThan(0);
    expect(heuristic.every((r) => r.entity_type === "network" || r.entity_type === "accelerator")).toBe(true);
    expect(records.find((r) => r.name_key === "india accelerator")!.entity_type).toBe("accelerator");
    expect(records.filter((r) => r.entity_type === "angel").every((r) => r.entity_type_source === "sheet")).toBe(true);
  });

  it("keeps individual angels distinct from the funds they are associated with", () => {
    const keys = records.map((r) => r.name_key);
    expect(keys).toContain("rainmatter"); // fund
    expect(keys).toContain("nithin kamath"); // person
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("importInvestors (PGlite, real migrations)", () => {
  let db: Db;
  beforeAll(async () => {
    db = await makeTestDb();
  });
  afterAll(() => db.close());

  it("is safe to run twice: second run changes nothing", async () => {
    const first = await importInvestors(db, records);
    expect(first).toMatchObject({ inserted: 82, updated: 0, unchanged: 0 });
    const second = await importInvestors(db, records);
    expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: 82 });
    expect((await db.query(`select 1 from investors`)).rowCount).toBe(82);
  });

  it("re-import updates profile data but never founder-owned, signal-derived or identity fields", async () => {
    const key = "blume ventures";
    // The founder (and a previous refresh) have added their own data:
    await db.query(
      `update investors set personal_notes='Met Karthik at SaaStr', contact_history='[{"date":"2026-09-02","note":"intro"}]',
              relationship_status='in_conversation', last_contact_date='2026-09-02', partner_name='Karthik Reddy',
              partner_profile_url='https://example.com/karthik', investment_thesis='Verified: early-stage India SaaS',
              thesis_verified=true, last_signal_date='2026-10-01', signal_summary='portfolio news',
              follow_up_score=81, recommended_action='reach_out_now'
        where name_key=$1`,
      [key],
    );
    const snapshot = async () =>
      (await db.query(
        `select personal_notes, contact_history, relationship_status, last_contact_date, partner_name, partner_profile_url,
                investment_thesis, thesis_verified, last_signal_date, signal_summary, follow_up_score, recommended_action,
                firm_name, name_key, entity_type
           from investors where name_key=$1`,
        [key],
      )).rows[0];
    const before = await snapshot();

    // A newer workbook changes profile fields AND carries different (placeholder) founder-owned values.
    const changed = records.map((r) =>
      r.name_key === key
        ? { ...r, website_url: "https://blume.vc/new", sectors: ["Logistics", "AI"], stage_preference: "Seed", firm_name: "Blume RENAMED",
            partner_name: "SOMEONE ELSE", personal_notes: "OVERWRITE ATTEMPT", relationship_status: "passed" as const,
            contact_history: [], last_contact_date: "2020-01-01" }
        : r,
    );
    const res = await importInvestors(db, changed);
    expect(res).toMatchObject({ inserted: 0, updated: 1, unchanged: 81 });

    expect(await snapshot()).toEqual(before); // every protected column is exactly as it was
    const { rows } = await db.query(`select website_url, sectors, stage_preference from investors where name_key=$1`, [key]);
    expect(rows[0]).toEqual({ website_url: "https://blume.vc/new", sectors: ["Logistics", "AI"], stage_preference: "Seed" });
  });

  it("never downgrades a manually verified investor", async () => {
    await db.query(`update investors set verification_status='verified' where name_key='seafund'`);
    await importInvestors(db, records.map((r) => (r.name_key === "seafund" ? { ...r, stage_preference: "changed" } : r)));
    const { rows } = await db.query(`select verification_status, stage_preference from investors where name_key='seafund'`);
    expect(rows[0]).toEqual({ verification_status: "verified", stage_preference: "changed" });
  });

  it("skips a record whose alias collides with an existing investor instead of creating a duplicate", async () => {
    const dup: InvestorRecord = { ...records[0]!, name_key: "totally new name", firm_name: "Totally New Name", aliases: ["Peak XV Partners"], source_ref: "test" };
    const res = await importInvestors(db, [dup]);
    expect(res.inserted).toBe(0);
    expect(res.skipped).toHaveLength(1);
    expect((await db.query(`select 1 from investors`)).rowCount).toBe(82);
  });
});

describe("parseWorkbookRows edge cases", () => {
  it("reports invalid rows and in-source duplicates without throwing", () => {
    const row = { firm_name: "Acme Capital", website_url: "https://acme.vc", geography: "India" };
    const { records: r, issues: i } = parseWorkbookRows([row, { ...row, firm_name: "ACME  capital!" }, { firm_name: "" }], []);
    expect(r).toHaveLength(1);
    expect(i.map((x) => x.severity).sort()).toEqual(["error", "warning"]);
  });

  it("ignores signal-derived values supplied by the workbook, with a warning", () => {
    const { records: r, issues: i } = parseWorkbookRows([{ firm_name: "Acme", follow_up_score: 99, signal_summary: "x" }], []);
    expect(r[0]).not.toHaveProperty("follow_up_score");
    expect(i.some((x) => /ignored/.test(x.message))).toBe(true);
  });

  it("keeps free-text contact history instead of losing it", () => {
    const { records: r } = parseWorkbookRows([{ firm_name: "Acme", contact_history: "Emailed 3 Sep, no reply" }], []);
    expect(r[0]!.contact_history).toEqual([{ date: null, note: "Emailed 3 Sep, no reply" }]);
  });
});
