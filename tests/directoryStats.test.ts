import { describe, expect, it } from "vitest";
import { getDirectoryStats, searchOrganisations } from "@/lib/directoryStats";
import { makeTestDb } from "./helpers/testDb";

describe("directory stats", () => {
  it("returns counts only: no personal field appears anywhere in the result", async () => {
    const db = await makeTestDb();
    await db.query(`insert into investor_directory (dedup_key, kind, name, email, phone, linkedin, sources) values
      ('e:a@x.in','angel','Asha Rao','a@x.in','9999900000','linkedin.com/in/asha','{"F / S1","F / S2"}'),
      ('n:|fund','vc',null,null,null,null,'{"F / S1"}')`);
    const s = await getDirectoryStats(db);
    expect(s).toMatchObject({ total: 2, withEmail: 1, withLinkedin: 1, withPhone: 1 });
    expect(s.bySource).toEqual([{ source: "F / S1", n: 2 }, { source: "F / S2", n: 1 }]);
    expect(JSON.stringify(s)).not.toMatch(/Asha|a@x\.in|9999900000|linkedin\.com/);
    await db.close();
  });
});

describe("cold search", () => {
  it("lists organisations with counts only, filters by type and text, and never returns a person's details", async () => {
    const db = await makeTestDb();
    await db.query(`insert into investor_directory (dedup_key, kind, name, organisation, email, phone, linkedin, location, sectors, sources) values
      ('e:p@acme.vc', 'vc', 'Priya Nair', 'Acme Ventures', 'p@acme.vc', '9876500001', 'linkedin.com/in/priya', 'Mumbai', 'logistics, saas', '{"F / S"}'),
      ('e:q@acme.vc', 'vc', 'Qasim Khan', 'ACME Ventures', 'q@acme.vc', null, null, 'Mumbai', null, '{"F / S"}'),
      ('e:z@zed.fo', 'family_office', 'Zed Owner', 'Zed Family Office', 'z@zed.fo', null, null, 'Dubai', 'fintech', '{"F / S"}'),
      ('e:solo@x.in', 'angel', 'Solo Angel', null, 'solo@x.in', null, null, 'Pune', 'logistics', '{"F / S"}')`);
    const all = await searchOrganisations(db);
    expect(all).toMatchObject({ orgTotal: 2, individuals: 1, contacts: 4 });
    expect(all.orgs[0]).toMatchObject({ contacts: 2, withEmail: 2, kind: "vc" }); // the two Acme rows are one organisation
    expect((await searchOrganisations(db, { kind: "family_office" })).orgs.map((o) => o.organisation)).toEqual(["Zed Family Office"]);
    expect(await searchOrganisations(db, { text: "logistics" })).toMatchObject({ orgTotal: 1, individuals: 1 });
    expect(await searchOrganisations(db, { text: "mumbai LOGISTICS" })).toMatchObject({ orgTotal: 1, individuals: 0 }); // each word on its own, any case, anywhere in the row
    expect((await searchOrganisations(db, { text: "logistics dubai" })).contacts).toBe(0);
    expect((await searchOrganisations(db, { text: "100%_" })).contacts).toBe(0); // wildcards are literal text
    expect(JSON.stringify(all)).not.toMatch(/Priya|Qasim|Zed Owner|Solo Angel|@|9876500001|linkedin\.com\/in/);
    await db.close();
  });

  it("only one file in the app reads the private table, and nothing in the app writes to it", async () => {
    const { execSync } = await import("node:child_process");
    const hits = execSync(`git grep -l investor_directory -- src`, { encoding: "utf8" }).trim().split("\n").sort();
    expect(hits).toEqual(["src/lib/directoryStats.ts"]);
    const writes = execSync(`git grep -nEi "(insert into|update|delete from) +investor_directory" -- src || true`, { encoding: "utf8" }).trim();
    expect(writes).toBe("");
  });
});
