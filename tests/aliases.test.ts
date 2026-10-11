import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { applyCuratedAliases, parseAliasCsv } from "@/lib/investors/aliases";
import { importInvestors, parseWorkbookRows, type InvestorRecord } from "@/lib/investors/import";
import { readWorkbook } from "@/lib/investors/workbook";
import { buildQuery } from "@/lib/refresh/research";
import { mentionsInvestor } from "@/lib/signals/match";
import { makeTestDb } from "./helpers/testDb";

let records: InvestorRecord[];
beforeAll(async () => {
  const { vc, angels } = await readWorkbook("data/india_vc_and_angel_profiles.xlsx");
  records = parseWorkbookRows(vc, angels).records;
});

describe("parseAliasCsv", () => {
  it("the shipped file parses cleanly and every alias cites a source", () => {
    const { rows, issues } = parseAliasCsv(readFileSync("data/aliases.csv", "utf8"));
    expect(issues).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((r) => /^https:\/\//.test(r.source_url))).toBe(true);
  });
  it("rejects an alias with no valid source — an uncited alias could mis-attribute news", () => {
    const { rows, issues } = parseAliasCsv("firm_name,alias,source_url\nAcme,Old Acme,\nAcme,Older Acme,not a url\nAcme,Real,https://x.com/y");
    expect(rows.map((r) => r.alias)).toEqual(["Real"]);
    expect(issues).toHaveLength(2);
  });
});

describe("applyCuratedAliases", () => {
  const { rows } = parseAliasCsv(readFileSync("data/aliases.csv", "utf8"));

  it("adds sourced aliases, flags them, and leaves identity untouched", () => {
    const before = records.find((r) => r.name_key === "peak xv partners")!;
    const { records: out, issues } = applyCuratedAliases(records, rows);
    expect(issues).toEqual([]);
    const after = out.find((r) => r.name_key === "peak xv partners")!;
    expect(after.aliases).toEqual(expect.arrayContaining(["Sequoia Capital India", "Sequoia India"]));
    expect(after.data_flags).toContain("alias_curated");
    expect(after.source_urls.some((u) => u.includes("peakxv.com"))).toBe(true);
    expect({ ...after, aliases: 0, data_flags: 0, source_urls: 0 }).toEqual({ ...before, aliases: 0, data_flags: 0, source_urls: 0 }); // nothing else changed
    expect(before.aliases).not.toContain("Sequoia India"); // input not mutated
  });

  it("existing workbook aliases are kept (Matrix Partners India ⇄ Z47) and not duplicated", () => {
    const m = applyCuratedAliases(records, rows).records.find((r) => r.name_key === "matrix partners india")!;
    expect(m.aliases.filter((a) => a === "Z47")).toHaveLength(1);
  });

  it("makes the former name searchable and matchable", () => {
    const peak = applyCuratedAliases(records, rows).records.find((r) => r.name_key === "peak xv partners")!;
    expect(buildQuery({ firm_name: peak.firm_name, aliases: peak.aliases, entity_type: peak.entity_type })).toContain("Sequoia Capital India");
    expect(mentionsInvestor("Sequoia Capital India backs a Seed round", peak)).toBe(true);
    expect(mentionsInvestor("Sequoia Capital US backs a Seed round", peak)).toBe(false);
  });

  it("skips an alias for an unknown firm, or one that another investor already owns, with a warning", () => {
    const { records: out, issues } = applyCuratedAliases(records, [
      { firm_name: "Nonexistent Fund", alias: "X", source_url: "https://x.com/a" },
      { firm_name: "Peak XV Partners", alias: "Blume Ventures", source_url: "https://x.com/b" },
    ]);
    expect(issues.map((i) => i.severity)).toEqual(["warning", "warning"]);
    expect(out.find((r) => r.name_key === "peak xv partners")!.aliases).not.toContain("Blume Ventures");
  });
});

describe("importing curated aliases never touches founder-owned data", () => {
  let db: Db;
  beforeAll(async () => { db = await makeTestDb(); });
  afterAll(() => db.close());

  it("aliases land in the database; notes, status and signal columns are unchanged by the re-import", async () => {
    await importInvestors(db, records);
    await db.query(`update investors set personal_notes='keep me', relationship_status='contacted', follow_up_score=77 where name_key='peak xv partners'`);
    const before = (await db.query(`select to_jsonb(i) - 'aliases' - 'data_flags' - 'source_urls' - 'updated_at' as r from investors i where name_key='peak xv partners'`)).rows[0];
    const { records: withAliases } = applyCuratedAliases(records, parseAliasCsv(readFileSync("data/aliases.csv", "utf8")).rows);
    const res = await importInvestors(db, withAliases);
    expect(res.updated).toBeGreaterThanOrEqual(4);
    const row = (await db.query(`select aliases, personal_notes, relationship_status, follow_up_score from investors where name_key='peak xv partners'`)).rows[0] as Record<string, unknown>;
    expect(row.aliases).toEqual(expect.arrayContaining(["Sequoia Capital India"]));
    expect(row).toMatchObject({ personal_notes: "keep me", relationship_status: "contacted", follow_up_score: 77 });
    const after = (await db.query(`select to_jsonb(i) - 'aliases' - 'data_flags' - 'source_urls' - 'updated_at' as r from investors i where name_key='peak xv partners'`)).rows[0];
    expect(after).toEqual(before);
  });
});
