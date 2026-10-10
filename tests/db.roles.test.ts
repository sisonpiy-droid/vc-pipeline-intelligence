import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { makeTestDb } from "./helpers/testDb";

let db: Db;
let id: string;

beforeAll(async () => {
  db = await makeTestDb();
  const r = await db.query<{ id: string }>(
    `insert into investors (entity_type, name_key, firm_name, personal_notes, contact_history, relationship_status)
     values ('vc_firm', 'acme', 'Acme', 'met at SaaStr, loves logistics', '[{"date":"2026-09-01","note":"intro call"}]', 'in_conversation')
     returning id`,
  );
  id = r.rows[0]!.id;
});
afterAll(() => db.close());

// These prove the DATABASE enforces the ownership boundary, independently of any TypeScript allowlist.
describe("vc_refresh role (database-enforced write boundary)", () => {
  it("can update exactly the four signal-derived columns", async () => {
    await db.tx(
      (q) =>
        q.query(
          `update investors set last_signal_date='2026-10-01', signal_summary='x', follow_up_score=77,
                  recommended_action='reach_out_now' where id=$1`,
          [id],
        ),
      { role: "vc_refresh" },
    );
    const { rows } = await db.query(`select follow_up_score from investors where id=$1`, [id]);
    expect(rows[0]).toEqual({ follow_up_score: 77 });
  });

  it.each(["personal_notes", "contact_history", "relationship_status", "last_contact_date", "partner_name", "firm_name", "investment_thesis", "sectors"])(
    "is refused permission to update %s",
    async (col) => {
      const value = col === "contact_history" ? `'[]'::jsonb` : col === "sectors" ? `'{x}'` : col === "last_contact_date" ? `'2026-01-01'` : col === "relationship_status" ? `'passed'` : `'hacked'`;
      await expect(
        db.tx((q) => q.query(`update investors set ${col} = ${value} where id=$1`, [id]), { role: "vc_refresh" }),
      ).rejects.toThrow(/permission denied/i);
    },
  );

  it("cannot read the founder-private columns at all", async () => {
    await expect(
      db.tx((q) => q.query(`select personal_notes from investors where id=$1`, [id]), { role: "vc_refresh" }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.tx((q) => q.query(`select contact_history from investors where id=$1`, [id]), { role: "vc_refresh" }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot delete investors", async () => {
    await expect(db.tx((q) => q.query(`delete from investors where id=$1`, [id]), { role: "vc_refresh" })).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("does not bump updated_at when only signal columns change", async () => {
    const before = (await db.query<{ updated_at: Date }>(`select updated_at from investors where id=$1`, [id])).rows[0]!.updated_at;
    await db.tx((q) => q.query(`update investors set follow_up_score=12 where id=$1`, [id]), { role: "vc_refresh" });
    const after = (await db.query<{ updated_at: Date }>(`select updated_at from investors where id=$1`, [id])).rows[0]!.updated_at;
    expect(after).toEqual(before);
  });

  it("only one run may be active at a time (overlap protection)", async () => {
    await db.query(`insert into runs (trigger_type) values ('cron')`);
    await expect(db.query(`insert into runs (trigger_type) values ('manual')`)).rejects.toThrow(/runs_single_active|duplicate key/i);
  });
});
