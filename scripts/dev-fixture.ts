/**
 * DEV ONLY — populates a LOCAL pglite database by running the real pipeline against canned providers,
 * so the dashboard can be reviewed without live API keys. Every article is titled "[FIXTURE]".
 * It refuses to run against anything but pglite://, so fixture data can never reach Supabase.
 *
 *   DATABASE_URL=pglite://.data/dev npm run import && npm run dev:fixture
 */
import { getDb } from "../src/lib/db";
import { runChunk, startRun } from "../src/lib/refresh/run";
import { asRefresh } from "../src/lib/refresh/write";
import { ProviderError, type SearchHit } from "../src/lib/providers/types";
import { article, fakeAi, fakePages, fakeSearch } from "../tests/helpers/fakes";

if (!process.env.DATABASE_URL?.startsWith("pglite://")) {
  console.error("dev-fixture refuses to run: DATABASE_URL must be a local pglite:// database. Fixture data is never written to a real database.");
  process.exit(1);
}

const db = getDb();
const rdb = asRefresh(db);
const now = new Date();
const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const pages: Record<string, string | ProviderError> = {};
const hits: Record<string, SearchHit[] | ProviderError> = {};
const rules: Record<string, Parameters<typeof fakeAi>[0] extends infer R ? R extends Record<string, infer V> ? V : never : never> = {};

function plant(firm: string, slug: string, age: number, over: { relevance?: number; confidence?: "high" | "medium" | "low"; summary?: string; title?: string } = {}) {
  const url = `https://fixture.example.com/${slug}`;
  const title = over.title ?? `[FIXTURE] ${firm} backs a logistics startup`;
  pages[url] = article(firm, day(age)).replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  (hits[firm] as SearchHit[] | undefined)?.push({ url, title, snippet: `${firm} led a five million dollar Seed round in a freight marketplace for trucking fleets.`, published_date: day(age), score: 0.9 });
  rules[url] = { relevance: over.relevance ?? 85, confidence: over.confidence ?? "high", summary: over.summary ?? `[FIXTURE] ${firm} led a Seed round in a freight-marketplace startup.` };
}
for (const f of ["Blume Ventures", "Athera Venture Partners", "Seafund", "Chiratae Ventures", "Elevation Capital", "Nithin Kamath", "Peak XV Partners", "Matrix Partners India"]) hits[f] = [];
plant("Blume Ventures", "blume-1", 2);
plant("Blume Ventures", "blume-2", 9, { relevance: 72, summary: "[FIXTURE] Blume partner interviewed on supply-chain software.", title: "[FIXTURE] Blume partner on supply-chain SaaS (podcast)" });
plant("Athera Venture Partners", "athera-1", 6, { relevance: 78, confidence: "medium" });
plant("Seafund", "seafund-1", 14, { relevance: 66 });
plant("Chiratae Ventures", "chiratae-1", 21, { relevance: 48, confidence: "medium" });
plant("Elevation Capital", "elevation-1", 4, { relevance: 12, summary: "[FIXTURE] Elevation announces a consumer-fintech fund." });
plant("Nithin Kamath", "nithin-1", 3, { relevance: 55 });
plant("Peak XV Partners", "peak-1", 5, { relevance: 90 });
plant("Matrix Partners India", "matrix-1", 8, { relevance: 80 });
hits["Accel India"] = new ProviderError("rate_limited", "Tavily rate limit (429)");
hits["Lightspeed India Partners"] = [{ url: "https://fixture.example.com/lightspeed-partial", title: "[FIXTURE] Lightspeed India note", snippet: "Lightspeed India Partners published a short note.", published_date: day(2), score: 0.5 }];
pages["https://fixture.example.com/lightspeed-partial"] = new ProviderError("http_5xx", "origin down");
rules["https://fixture.example.com/lightspeed-partial"] = { relevance: 10 };

// Founder-owned data for two investors, to show read-only relationship handling and the "don't chase" list.
await db.query(`update investors set relationship_status='awaiting_response', last_contact_date=$1, personal_notes='[FIXTURE] Sent deck on Mon; partner said she would reply by Friday.',
  contact_history='[{"date":"${day(4)}","channel":"email","note":"[FIXTURE] intro + deck"}]'::jsonb where firm_name='Peak XV Partners'`, [day(4)]);
await db.query(`update investors set relationship_status='passed', personal_notes='[FIXTURE] Passed in Aug: too early for them.' where firm_name='Matrix Partners India'`);

const { run_id } = await startRun(rdb, "manual");
const r = await runChunk(rdb, { search: fakeSearch(hits), pages: fakePages(pages), ai: fakeAi(rules), now: () => now }, run_id, { budgetMs: 300_000, batchEstimateMs: 0, concurrency: 4 });
console.log(`Fixture run ${r.status}; ${(await db.query(`select count(*)::int n from signals where verification_status='verified'`)).rows[0] && ""}done.`);
await db.close();
