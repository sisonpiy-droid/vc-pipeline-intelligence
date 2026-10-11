/**
 * Re-scores every investor from the evidence already stored. No search credits are used.
 *   npm run rescore               arithmetic only (no network, no model): applies today's recency and the current rules
 *   npm run rescore -- --review   first runs the Gemini second-pass review on stored in-window evidence that has none
 *                                 (one call per investor), then re-scores and drafts missing opening angles
 * Writes exactly the four signal columns, as the refresh role, like a refresh does.
 */
import { createGemini } from "../src/lib/ai/gemini";
import { getDb } from "../src/lib/db";
import { reviewStored } from "../src/lib/refresh/review";
import { rescoreAll } from "../src/lib/refresh/rescore";
import { asRefresh } from "../src/lib/refresh/write";

const withReview = process.argv.includes("--review");
const db = getDb();
const rdb = asRefresh(db);
if ((await rdb.query(`select 1 from runs where status = 'running'`)).rowCount > 0) throw new Error("a refresh is running; try again when it has finished");

const before = (await db.query(`select recommended_action a, count(*)::int n from investors group by 1 order by 1`)).rows;
const ai = withReview ? createGemini() : undefined;
if (ai) console.log("review:", JSON.stringify(await reviewStored(rdb, ai, new Date())));
console.log("rescore:", JSON.stringify(await rescoreAll(rdb, new Date(), { ai })));
const after = (await db.query(`select recommended_action a, count(*)::int n from investors group by 1 order by 1`)).rows;
console.log("actions before:", JSON.stringify(before));
console.log("actions after: ", JSON.stringify(after));
await db.close();
