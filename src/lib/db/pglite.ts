import type { PGlite } from "@electric-sql/pglite";
import type { Db, Queryable } from "./index";

/**
 * Db adapter over PGlite (in-process Postgres). Used by the test-suite and for local development
 * (`DATABASE_URL=pglite://.data/dev`). Never used in production, where DATABASE_URL points at Supabase.
 */
export function pgliteDb(pg: PGlite): Db {
  const wrap = (t: { query: PGlite["query"] }): Queryable => ({
    async query(sql, params) {
      const r = await t.query(sql, params as unknown[]);
      // PGlite reports affectedRows = 0 for SELECT; node-postgres reports the row count. Match pg.
      return { rows: r.rows as never, rowCount: Math.max(r.rows.length, r.affectedRows ?? 0) };
    },
  });
  return {
    ...wrap(pg),
    async exec(sql) {
      await pg.exec(sql);
    },
    tx: (fn, opts) =>
      pg.transaction(async (t) => {
        if (opts?.role) await t.query(`set local role ${opts.role}`);
        return fn(wrap(t));
      }),
    close: () => pg.close(),
  };
}

/** `dataDir` undefined → in-memory. Dates are returned as YYYY-MM-DD strings, like the pg driver config. */
export async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  return pgliteDb(new PGlite(dataDir, { parsers: { 1082: (v: string) => v } }));
}
