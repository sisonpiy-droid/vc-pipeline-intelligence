import pg from "pg";

/**
 * Minimal database interface. Production uses `pg` against Supabase's pooled connection string;
 * tests run the same SQL on PGlite (in-process Postgres). All SQL in the app goes through this,
 * so there is exactly one place where connections, transactions and roles are handled.
 */
export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

export interface Db extends Queryable {
  /** Run several statements (no params) — used by the migration runner. Atomic. */
  exec(sql: string): Promise<void>;
  /**
   * Run `fn` in one transaction. With `role`, the transaction runs as that Postgres role
   * (`SET LOCAL ROLE`), so the database itself enforces that role's grants — this is how a
   * refresh is confined to the four signal-derived columns.
   */
  tx<T>(fn: (q: Queryable) => Promise<T>, opts?: { role?: "vc_refresh" }): Promise<T>;
  close(): Promise<void>;
}

const ROLE_RE = /^[a-z_]+$/;

export function pgDb(connectionString: string): Db {
  // Supabase's pooler presents a certificate chain Node does not trust by default.
  // ponytail: TLS without chain verification (traffic is still encrypted). Pin Supabase's CA via
  // `ssl: { ca }` if the threat model includes an active MITM on the path to the pooler.
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
    max: 3, // per serverless instance; the Supabase pooler multiplexes the rest
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });

  return {
    async query(sql, params) {
      const r = await pool.query(sql, params as unknown[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async exec(sql) {
      await pool.query(sql); // simple-query protocol: a multi-statement string is one implicit transaction
    },
    async tx(fn, opts) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        if (opts?.role) {
          if (!ROLE_RE.test(opts.role)) throw new Error("invalid role name");
          await client.query(`set local role ${opts.role}`);
        }
        const out = await fn({
          async query(sql, params) {
            const r = await client.query(sql, params as unknown[]);
            return { rows: r.rows, rowCount: r.rowCount ?? 0 };
          },
        });
        await client.query("commit");
        return out;
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Lazily-created shared connection (survives Next.js dev hot reloads). */
export function getDb(): Db {
  const g = globalThis as unknown as { __vcDb?: Db };
  if (!g.__vcDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Use the Supabase 'Transaction pooler' connection string (see .env.example).",
      );
    }
    g.__vcDb = pgDb(url);
  }
  return g.__vcDb;
}
