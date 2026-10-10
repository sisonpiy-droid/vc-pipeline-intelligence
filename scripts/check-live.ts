/**
 * Verifies the REAL integrations with the smallest possible spend: ≈1 Tavily credit, 2 Gemini calls,
 * 1 page fetch, 1 DB round-trip. Nothing is written. Run after setting .env:
 *
 *   npm run check:live
 *
 * Output is PASS/FAIL per check and never prints a secret.
 */
import { createGemini, DEFAULT_MODEL, AiError } from "../src/lib/ai/gemini";
import { getDb } from "../src/lib/db";
import { extractPage } from "../src/lib/providers/extract";
import { createPageFetcher } from "../src/lib/providers/fetchPage";
import { createTavily } from "../src/lib/providers/tavily";
import { isoDay, windowStart } from "../src/lib/signals/window";

let failed = 0;
const ok = (name: string, detail = "") => console.log(`PASS  ${name}${detail ? `  — ${detail}` : ""}`);
const bad = (name: string, detail: string) => { failed++; console.log(`FAIL  ${name}  — ${detail}`); };
const step = async (name: string, fn: () => Promise<string | void>) => {
  try { ok(name, (await fn()) || ""); } catch (e) { bad(name, e instanceof Error ? `${(e as AiError).category ?? ""} ${e.message}`.trim() : String(e)); }
};

const need = ["DATABASE_URL", "GEMINI_API_KEY", "TAVILY_API_KEY", "CRON_SECRET"].filter((n) => !process.env[n]);
if (need.length) bad("environment", `missing: ${need.join(", ")}`);
else ok("environment", "all required variables are set");

await step("database reachable + migrated", async () => {
  const db = getDb();
  const r = await db.query<{ n: number }>(`select count(*)::int as n from investors`);
  const m = await db.query<{ name: string }>(`select name from schema_migrations order by name`);
  await db.close();
  return `${r.rows[0]!.n} investors; migrations: ${m.rows.map((x) => x.name).join(", ")}`;
});

const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
await step(`Gemini model "${model}" exists`, async () => {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — set GEMINI_MODEL to a current Flash model id`);
  const j = (await res.json()) as { displayName?: string; supportedGenerationMethods?: string[] };
  if (!j.supportedGenerationMethods?.includes("generateContent")) throw new Error("model does not support generateContent");
  return j.displayName ?? "";
});

await step("Gemini structured JSON output", async () => {
  const out = (await createGemini().generateJson({
    system: "Reply with JSON only.",
    prompt: "Is 2 + 2 equal to 4? Answer with ok=true or ok=false.",
    responseSchema: { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } }, required: ["ok"] },
  })) as { ok?: boolean };
  if (out.ok !== true) throw new Error(`unexpected output ${JSON.stringify(out)}`);
  return "schema-constrained reply parsed";
});

const now = new Date();
let firstUrl: string | undefined;
await step("Tavily search (dated, last 30 days)", async () => {
  const hits = await createTavily().search({ query: '"Blume Ventures" (logistics OR "supply chain" OR investment)', startDate: windowStart(now), endDate: isoDay(now), maxResults: 5 });
  firstUrl = hits[0]?.url;
  return `${hits.length} result(s)` + hits.slice(0, 3).map((h) => `\n        ${h.published_date ?? "no date"}  ${h.url}`).join("");
});

if (firstUrl) {
  await step("page fetch + date extraction (SSRF-guarded, robots-aware)", async () => {
    const page = extractPage((await createPageFetcher().fetch(firstUrl!)).html);
    return `title "${page.title.slice(0, 60)}", ${page.text.length} chars, page date ${page.published_at ?? "none"}${page.date_conflict ? " (CONFLICT)" : ""}`;
  });
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll live checks passed.");
process.exit(failed ? 1 : 0);
