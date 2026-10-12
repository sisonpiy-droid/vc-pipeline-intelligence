import { describe, expect, it } from "vitest";
import { getDirectoryStats } from "@/lib/directoryStats";
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
