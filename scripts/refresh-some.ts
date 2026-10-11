/**
 * Runs the REAL pipeline (live Tavily, Gemini, official feeds) for a few named investors — a cheap way to verify the
 * deployed behaviour end to end: one search credit per investor.   npm run refresh:some -- "Seafund" "Speciale Invest"
 */
import { getDb } from "../src/lib/db";
import { productionDeps } from "../src/lib/refresh/service";
import { runChunk } from "../src/lib/refresh/run";
import { asRefresh } from "../src/lib/refresh/write";

const names = process.argv.slice(2);
if (!names.length) throw new Error('give at least one investor name, e.g. npm run refresh:some -- "Seafund"');
const db = getDb();
const rdb = asRefresh(db);

if ((await rdb.query(`select 1 from runs where status = 'running'`)).rowCount > 0) throw new Error("a run is already active");
const ids = (await rdb.query<{ id: string; firm_name: string }>(`select id, firm_name from investors where firm_name = any($1::text[])`, [names])).rows;
if (ids.length !== names.length) throw new Error(`not found: ${names.filter((n) => !ids.some((i) => i.firm_name === n)).join(", ")}`);

const run = (await rdb.query<{ id: string }>(
  `insert into runs (trigger_type, investors_total, plan) values ('manual', $1, $2::jsonb) returning id`,
  [ids.length, JSON.stringify({ targeted: names, expected_searches: ids.length })],
)).rows[0]!;
await rdb.query(`insert into run_items (run_id, investor_id) select $1, unnest($2::uuid[])`, [run.id, ids.map((i) => i.id)]);

const r = await runChunk(rdb, { ...productionDeps(), linkedin: false, officialFeeds: true }, run.id, { budgetMs: 200_000, batchEstimateMs: 0 });
console.log(`Run ${r.status}`);
const rows = (await db.query(`select i.firm_name, ri.status, ri.error, i.follow_up_score s, i.recommended_action a,
    ri.outcome->>'coverage' cov, ri.outcome->>'angle' angle, ri.outcome->'rejected' rej
  from run_items ri join investors i on i.id = ri.investor_id where ri.run_id = $1`, [run.id])).rows;
for (const x of rows as Record<string, unknown>[]) console.log(`\n${x.firm_name}: ${x.status} score=${x.s} action=${x.a} coverage=${x.cov} ${x.error ?? ""}\n  angle: ${x.angle ?? "—"}\n  rejected: ${JSON.stringify(x.rej)}`);
console.log("\ncoverage:", JSON.stringify((await db.query(`select i.firm_name, sc.source, sc.status, sc.result_count n from source_coverage sc join investors i on i.id=sc.investor_id where sc.run_id=$1 order by 1,2`, [run.id])).rows));
console.log("official/feed signals:", JSON.stringify((await db.query(`select i.firm_name, s.date_source, s.verification_status v, s.relevance_score rel, s.new_capital nc, left(s.headline,60) h from signals s join investors i on i.id=s.investor_id where s.run_id=$1 and (s.date_source='feed')`, [run.id])).rows));
console.log("run counters:", JSON.stringify((await db.query(`select status, search_calls, investors_processed, signals_accepted, error_count from runs where id=$1`, [run.id])).rows[0]));
await db.close();
