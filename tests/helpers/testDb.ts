import { PGlite } from "@electric-sql/pglite";
import type { Db, Queryable } from "@/lib/db";
import { applyMigrations } from "@/lib/db/migrate";

/** A fresh, fully-migrated in-process Postgres. Runs the real migration files, not a copy of them. */
export async function makeTestDb(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = {
    async query(sql, params) {
      const r = await pg.query(sql, params as unknown[]);
      return { rows: r.rows as never, rowCount: Math.max(r.rows.length, r.affectedRows ?? 0) };
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    async tx(fn, opts) {
      return pg.transaction(async (t) => {
        if (opts?.role) await t.query(`set local role ${opts.role}`);
        const q: Queryable = {
          async query(sql, params) {
            const r = await t.query(sql, params as unknown[]);
            return { rows: r.rows as never, rowCount: Math.max(r.rows.length, r.affectedRows ?? 0) };
          },
        };
        return fn(q);
      });
    },
    close: () => pg.close(),
  };
  await applyMigrations(db);
  return db;
}
