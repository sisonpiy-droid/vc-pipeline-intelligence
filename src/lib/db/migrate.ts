import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./index";

// Only used by scripts, tests and the dev-only pglite:// mode — never by a production request. The ignore
// comment stops the bundler from tracing the whole project into the serverless output for this path.
export const MIGRATIONS_DIR = join(/*turbopackIgnore: true*/ process.cwd(), "supabase", "migrations");

/** Applies supabase/migrations/*.sql in filename order, once each. Safe to re-run. */
export async function applyMigrations(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    // One multi-statement query = one implicit transaction: a failing migration leaves nothing behind.
    await db.exec(`${sql}\n;insert into schema_migrations (name) values ('${file.replace(/'/g, "''")}');`);
    applied.push(file);
  }
  return applied;
}
