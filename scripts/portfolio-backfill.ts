/**
 * Runs the portfolio check for every investor that is due (never checked, last attempt failed, or older than 30 days).
 * Direct HTTP to each investor's own site + one Gemini call each; no search credits. A refresh does this too, one
 * investor at a time; this is the one-off way to fill the list for everyone at once.
 *   npm run portfolio:backfill               everyone due
 *   npm run portfolio:backfill -- Blume Kae  only names containing these words
 */
import { getDb } from "../src/lib/db";
import { checkPortfolio, portfolioDue, storePortfolio } from "../src/lib/refresh/portfolio";
import { loadInvestor } from "../src/lib/refresh/rescore";
import { productionDeps } from "../src/lib/refresh/service";
import { asRefresh } from "../src/lib/refresh/write";

const only = process.argv.slice(2).map((s) => s.toLowerCase());
const db = getDb();
const rdb = asRefresh(db);
const deps = { ...productionDeps(), portfolio: true };
const ids = (await rdb.query<{ id: string; firm_name: string }>(`select id, firm_name from investors where entity_type <> 'angel' and website_url is not null order by firm_name`)).rows
  .filter((r) => !only.length || only.some((o) => r.firm_name.toLowerCase().includes(o)));

const tally: Record<string, number> = {};
let aiCalls = 0;
for (const { id, firm_name } of ids) {
  if (!only.length && !(await portfolioDue(rdb, id, new Date()))) { tally.not_due = (tally.not_due ?? 0) + 1; continue; }
  const inv = (await loadInvestor(rdb, id))!;
  const res = await checkPortfolio(deps, inv);
  if (res.kind === "skip") continue;
  aiCalls += res.ai_calls;
  await storePortfolio(rdb, null, id, res);
  tally[res.coverage.status] = (tally[res.coverage.status] ?? 0) + 1;
  console.log(`${firm_name.padEnd(34)} ${res.coverage.status.padEnd(8)} ${String(res.coverage.result_count).padStart(3)} companies  ${res.coverage.note ?? res.coverage.error_category ?? ""}`);
}
console.log(`\n${JSON.stringify(tally)} · ${aiCalls} Gemini calls`);
const top = (await db.query(`select i.firm_name, count(*) filter (where p.logistics_related)::int logistics, count(*) filter (where p.competitor_risk = 'direct')::int direct, count(*)::int total
  from portfolio_companies p join investors i on i.id = p.investor_id group by 1 order by logistics desc, total desc limit 10`)).rows;
console.log("most logistics-heavy portfolios:", JSON.stringify(top));
await db.close();
