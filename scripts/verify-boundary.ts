/** Proves the vc_refresh role boundary on the connected database. Writes nothing permanent (all in rolled-back transactions). */
import { getDb } from "../src/lib/db";
const db = getDb();
const id = (await db.query<{ id: string }>("select id from investors order by firm_name limit 1")).rows[0]!.id;
let fail = 0;
const expectDenied = async (name: string, sql: string) => {
  try { await db.tx((q) => q.query(sql, [id]), { role: "vc_refresh" }); fail++; console.log(`FAIL  ${name}: was allowed`); }
  catch (e) { console.log(/permission denied/i.test(String((e as Error).message)) ? `PASS  ${name}: denied by the database` : `FAIL  ${name}: ${(e as Error).message.slice(0, 80)}`); if (!/permission denied/i.test(String((e as Error).message))) fail++; }
};
await expectDenied("update personal_notes", "update investors set personal_notes='x' where id=$1");
await expectDenied("update relationship_status", "update investors set relationship_status='passed' where id=$1");
await expectDenied("read personal_notes", "select personal_notes from investors where id=$1");
await expectDenied("delete investor", "delete from investors where id=$1");
try {
  await db.tx(async (q) => { await q.query("update investors set follow_up_score=1 where id=$1", [id]); throw new Error("rollback-probe"); }, { role: "vc_refresh" });
} catch (e) { const ok = (e as Error).message === "rollback-probe"; console.log(ok ? "PASS  update of the 4 signal columns: allowed (rolled back)" : `FAIL  signal update: ${(e as Error).message.slice(0, 80)}`); if (!ok) fail++; }
console.log("investors:", (await db.query<{ n: number }>("select count(*)::int n from investors")).rows[0]!.n);
await db.close();
process.exit(fail ? 1 : 0);
