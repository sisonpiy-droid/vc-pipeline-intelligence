import { describe, expect, it } from "vitest";
import { clean, emailsOf, keepPlatform, linkedinOf, mergeRecords, phoneOf, toRecord } from "@/lib/investors/directory";
import { makeTestDb } from "./helpers/testDb";

describe("private contact directory", () => {
  it("keeps only MV and MV-or-Mynt platform rows; Mynt-only and blank are dropped", () => {
    expect(["MV", "mv", "MV : MYNT", "MV or Mynt", "Mynt", "MYNT", "", null, undefined].map(keepPlatform)).toEqual([true, true, true, true, false, false, false, false, false]);
  });

  it("cleans cells: placeholders, number-phones, emails in text, LinkedIn handles", () => {
    expect(clean("  - ")).toBeNull();
    expect(phoneOf("9820129961.0")).toBe("9820129961");
    expect(emailsOf("Reach me: A.B@Ex.com / second@ex.org")).toEqual(["a.b@ex.com", "second@ex.org"]);
    expect(linkedinOf("`https://www.linkedin.com/in/Some-One-12/?x=1")).toBe("linkedin.com/in/some-one-12");
    expect(linkedinOf("https://www.linkedin.com/in/")).toBeNull();
  });

  it("merges the same person across sheets: first value wins, every source is kept", () => {
    const a = toRecord({ kind: "angel", name: "Asha", emails: ["asha@x.in"] }, "A")!;
    const b = toRecord({ kind: "angel", name: "Asha R", organisation: "Fund", emails: ["asha@x.in"], extra: { k: "v" } }, "B")!;
    const [m, ...rest] = mergeRecords([a, b]);
    expect(rest).toHaveLength(0);
    expect(m).toMatchObject({ name: "Asha", organisation: "Fund", sources: ["A", "B"], extra: { k: "v" } });
    expect(toRecord({ kind: "other" }, "A")).toBeNull(); // nothing to identify the row
  });

  it("the table exists but is unreadable to the refresh role and anon", async () => {
    const db = await makeTestDb();
    await db.query("insert into investor_directory (dedup_key, kind, name) values ('n:x|', 'angel', 'X')");
    await expect(db.tx((q) => q.query("select * from investor_directory"), { role: "vc_refresh" })).rejects.toThrow(/permission denied/);
    await db.close();
  });
});
