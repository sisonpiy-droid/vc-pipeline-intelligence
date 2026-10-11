/**
 * Measures how many tracked firms publish an RSS/Atom feed and how many have posts in the last 30 days.
 * Uses only direct HTTP (SSRF-guarded, robots-aware): costs no search credits and writes nothing.
 *   npm run check:feeds
 */
import { getDb } from "../src/lib/db";
import { fetchOfficialFeed } from "../src/lib/providers/feeds";
import { createPageFetcher } from "../src/lib/providers/fetchPage";
import { isoDay, windowStart } from "../src/lib/signals/window";

const db = getDb();
const firms = (await db.query<{ firm_name: string; website_url: string }>(
  `select firm_name, website_url from investors where website_url is not null order by firm_name`,
)).rows;
const pages = createPageFetcher();
const now = new Date();
const tally = { found: 0, none: 0, error: 0, withRecent: 0, recentItems: 0 };
const lines: string[] = [];

let next = 0;
await Promise.all(
  Array.from({ length: 5 }, async () => {
    while (next < firms.length) {
      const f = firms[next++]!;
      const r = await fetchOfficialFeed(pages, f.website_url, windowStart(now), isoDay(now));
      if (r.status === "found") {
        tally.found++;
        if (r.inWindow.length) { tally.withRecent++; tally.recentItems += r.inWindow.length; }
        lines.push(`FEED   ${f.firm_name.padEnd(28)} ${r.inWindow.length} in window / ${r.items.length} items  ${r.feedUrl}`);
      } else if (r.status === "none") {
        tally.none++;
        lines.push(`none   ${f.firm_name.padEnd(28)} ${r.note}`);
      } else {
        tally.error++;
        lines.push(`ERROR  ${f.firm_name.padEnd(28)} ${r.error.category}: ${r.error.message}`);
      }
    }
  }),
);
console.log(lines.sort().join("\n"));
console.log(`\n${firms.length} firms with a website: ${tally.found} publish a feed (${tally.withRecent} with a post in the last 30 days, ${tally.recentItems} items), ${tally.none} have none, ${tally.error} errored.`);
await db.close();
