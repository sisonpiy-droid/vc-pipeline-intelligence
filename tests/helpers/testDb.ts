import type { Db } from "@/lib/db";
import { applyMigrations } from "@/lib/db/migrate";
import { openPglite } from "@/lib/db/pglite";

/** A fresh, fully-migrated in-process Postgres. Runs the real migration files, not a copy of them. */
export async function makeTestDb(): Promise<Db> {
  const db = await openPglite();
  await applyMigrations(db);
  return db;
}
