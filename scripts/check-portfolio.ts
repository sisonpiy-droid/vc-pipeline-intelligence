/**
 * Probe: can we read each investor's portfolio page over plain HTTP? No Gemini, no search credits, read-only.
 *   npm run check:portfolio              all VC firms with a website
 *   npm run check:portfolio -- Blume Kae  only names containing these words
 */
import { getDb } from "../src/lib/db";
import { createPageFetcher } from "../src/lib/providers/fetchPage";
import { fetchPortfolioPage } from "../src/lib/providers/portfolioPage";

const only = process.argv.slice(2).map((s) => s.toLowerCase());
const db = getDb();
const rows = (await db.query<{ firm_name: string; website_url: string }>(
  `select firm_name, website_url from investors where entity_type <> 'angel' and website_url is not null order by firm_name`,
)).rows.filter((r) => !only.length || only.some((o) => r.firm_name.toLowerCase().includes(o)));
const pages = createPageFetcher();
let found = 0;
const stats: Record<string, number> = {};
for (const r of rows) {
  const res = await fetchPortfolioPage(pages, r.website_url);
  const label = res.status === "found" ? `found ${res.text.length} chars @ ${res.url}` : res.status === "none" ? `none: ${res.note}` : `error: ${res.error.category}`;
  const key = res.status === "found" ? "found" : res.status === "none" ? (/almost no readable/.test(res.note) ? "thin" : "none") : "error";
  stats[key] = (stats[key] ?? 0) + 1;
  if (res.status === "found") found++;
  console.log(`${r.firm_name.padEnd(34)} ${label}`);
}
console.log(`\n${found} of ${rows.length} portfolio pages readable`, JSON.stringify(stats));
await db.close();
