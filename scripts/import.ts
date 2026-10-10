import { resolve } from "node:path";
import { getDb } from "../src/lib/db";
import { importInvestors, parseWorkbookRows } from "../src/lib/investors/import";
import { readWorkbook } from "../src/lib/investors/workbook";

// Usage: npm run import [-- path/to/workbook.xlsx] [--dry-run]
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const path = resolve(args.find((a) => !a.startsWith("--")) ?? "data/india_vc_and_angel_profiles.xlsx");

const { vc, angels } = await readWorkbook(path);
const { records, issues } = parseWorkbookRows(vc, angels);
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
