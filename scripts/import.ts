import { resolve } from "node:path";
import { getDb } from "../src/lib/db";
import { existsSync, readFileSync } from "node:fs";
import { applyCuratedAliases, parseAliasCsv } from "../src/lib/investors/aliases";
import { importInvestors, parseWorkbookRows } from "../src/lib/investors/import";
import { readWorkbook } from "../src/lib/investors/workbook";

// Usage: npm run import [-- path/to/workbook.xlsx] [--dry-run]
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const path = resolve(args.find((a) => !a.startsWith("--")) ?? "data/india_vc_and_angel_profiles.xlsx");

const { vc, angels } = await readWorkbook(path);
const parsed = parseWorkbookRows(vc, angels);
const aliasFile = resolve("data/aliases.csv");
const aliases = existsSync(aliasFile) ? parseAliasCsv(readFileSync(aliasFile, "utf8")) : { rows: [], issues: [] };
const merged = applyCuratedAliases(parsed.records, aliases.rows);
const records = merged.records;
const issues = [...parsed.issues, ...aliases.issues, ...merged.issues];
console.log(`Curated aliases: ${aliases.rows.length} sourced rows applied from data/aliases.csv`);
console.log(`Read ${vc.length} VC rows + ${angels.length} angel rows from ${path}`);
console.log(`Parsed ${records.length} investors; ${issues.length} issue(s)`);
for (const i of issues) console.log(`  [${i.severity}] ${i.ref}: ${i.message}`);

if (dry) {
  console.log("--dry-run: nothing written.");
} else {
  const db = getDb();
  const r = await importInvestors(db, records);
  console.log(`Import: ${r.inserted} inserted, ${r.updated} updated, ${r.unchanged} unchanged, ${r.skipped.length} skipped`);
  for (const s of r.skipped) console.log(`  [skipped] ${s.ref}: ${s.message}`);
  await db.close();
}
