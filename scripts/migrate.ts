import { getDb } from "../src/lib/db";
import { applyMigrations } from "../src/lib/db/migrate";

const db = getDb();
const applied = await applyMigrations(db);
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database already up to date.");
await db.close();
