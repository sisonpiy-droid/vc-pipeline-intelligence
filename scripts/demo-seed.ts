/**
 * Creates (or recreates) the six labelled demo accounts. Deletes only rows flagged is_demo; real data is never touched.
 *   npm run demo:seed
 */
import { getDb } from "../src/lib/db";
import { resetDemo } from "../src/lib/demoData/seed";

const db = getDb();
console.log(JSON.stringify(await resetDemo(db)));
await db.close();
