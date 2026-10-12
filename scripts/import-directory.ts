/**
 * Loads the founder's cold spreadsheets into the private `investor_directory` table (migration 0008). Nothing in the app reads it.
 *   npm run directory:import -- [--dry-run] [--dir "C:/Users/me/Downloads"]
 * Re-running is safe: rows are keyed (email, else LinkedIn handle, else name + organisation) and merged, never duplicated.
 */
import { join } from "node:path";
import { getDb } from "../src/lib/db";
import {
  clean, emailsOf, keepPlatform, kindOf, linkedinOf, mergeRecords, phoneOf, toRecord,
  type DirectoryKind, type DirectoryRecord,
} from "../src/lib/investors/directory";

type Row = Record<string, string | null>;

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const dir = args[args.indexOf("--dir") + 1] && args.includes("--dir") ? args[args.indexOf("--dir") + 1]! : join(process.env.USERPROFILE ?? ".", "Downloads");

function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    return cellText(o.text ?? o.result ?? o.hyperlink ?? null);
  }
  return String(v);
}

async function readSheet(file: string, sheet: string, headerRow = 1): Promise<Row[]> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(dir, file));
  const ws = wb.getWorksheet(sheet);
  if (!ws) throw new Error(`${file}: no sheet "${sheet}" (found: ${wb.worksheets.map((w) => w.name).join(", ")})`);
  const headers: string[] = [];
  ws.getRow(headerRow).eachCell({ includeEmpty: true }, (c, i) => (headers[i - 1] = (cellText(c.value) ?? "").trim().toLowerCase()));
  const rows: Row[] = [];
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const o: Row = {};
    headers.forEach((h, i) => { if (h && !(h in o)) o[h] = cellText(row.getCell(i + 1).value); });
    if (Object.values(o).some((v) => clean(v))) rows.push(o);
  });
  return rows;
}

const g = (r: Row, k: string) => clean(r[k]);
const mails = (r: Row, ...keys: string[]) => keys.flatMap((k) => emailsOf(r[k]));
const mentionsMynt = (r: Row) => Object.values(r).some((v) => v && /\bmynt\b/i.test(v));

interface Source {
  file: string;
  sheet: string;
  headerRow?: number;
  /** Rows to drop before mapping (counted in the report). */
  exclude?: (r: Row) => boolean;
  map: (r: Row) => Parameters<typeof toRecord>[0];
}

const MYNT = "Investor Tracker _Mynt_ (1).xlsx";
const SOURCES: Source[] = [
  { file: "UAE Investor List (1).xlsx", sheet: "UAE", map: (r) => ({
      kind: kindOf(g(r, "investor type"), "other"), organisation: g(r, "name"), location: g(r, "location"),
      investor_type: g(r, "investor type"), stage: g(r, "investor stage"),
      extra: { investments: g(r, "number of investments"), exits: g(r, "number of exits"), monthly_visits: g(r, "monthly visits (website)") },
    }) },
  // The tracker's MV list: only contacts whose platform is MV or "MV : MYNT" (Mynt-only and blank-platform rows are dropped).
  { file: MYNT, sheet: "MV Angels <Tracker>", exclude: (r) => !keepPlatform(r["platform"]), map: (r) => ({
      kind: "angel", name: g(r, "name"), organisation: g(r, "company"), designation: g(r, "designation"), emails: mails(r, "email 1", "email 2"),
      phone: phoneOf(r["contact no."]), linkedin: linkedinOf(r["linkedin page"]), status: g(r, "status"), remarks: g(r, "general remarks"),
      extra: { platform: g(r, "platform"), ownership: g(r, "ownership"), last_contact: g(r, "last contact date") },
    }) },
  // The tracker's other lists have no platform column; any row that mentions Mynt at all is left out.
  { file: MYNT, sheet: "VC | Network <Tracker>", exclude: mentionsMynt, map: (r) => ({
      kind: "vc", name: g(r, "name"), organisation: g(r, "company name"), designation: g(r, "designation"),
      emails: mails(r, "email id 1", "email id 2"), phone: phoneOf(r["mobile no."]), linkedin: linkedinOf(r["linkedin page"]),
      status: g(r, "status"), remarks: g(r, "general remarks"), stage: g(r, "stage of investment"), thesis: g(r, "investment thesis"),
      sectors: g(r, "sectors"), location: g(r, "location"),
      extra: { reference: g(r, "reference"), cheque_size: g(r, "cheque size"), followup: g(r, "followup date") },
    }) },
  { file: MYNT, sheet: "Angels Data <Cold>", exclude: mentionsMynt, map: (r) => ({
      kind: "angel", name: g(r, "name"), organisation: g(r, "company"), designation: g(r, "designation"), emails: mails(r, "email 1", "email 2"),
      phone: phoneOf(r["phone"]), linkedin: linkedinOf(r["linkedin"]), website: g(r, "website"), status: g(r, "status"), remarks: g(r, "remarks"),
      extra: { source: g(r, "source"), last_contacted: g(r, "last date contacted"), twitter: g(r, "twitter") },
    }) },
  { file: MYNT, sheet: "VC <Cold>", exclude: mentionsMynt, map: (r) => ({
      kind: kindOf(g(r, "investor type"), "vc"), name: g(r, "name"), organisation: g(r, "investor company name"), designation: g(r, "designation"),
      emails: mails(r, "email 1", "email 2"), phone: phoneOf(r["phone no."]), linkedin: linkedinOf(r["linkedin"]), website: g(r, "website"),
      status: g(r, "status"), remarks: g(r, "remarks"), investor_type: g(r, "investor type"), sectors: g(r, "investment sectors"),
      stage: g(r, "stage of investment"), thesis: g(r, "investment thesis"), location: g(r, "global hq"),
      extra: { first_cheque_min: g(r, "first cheque minimum"), first_cheque_max: g(r, "first cheque maximum"), countries: g(r, "countries of investment") },
    }) },
  { file: MYNT, sheet: "Angels <COLD>", exclude: mentionsMynt, map: (r) => ({
      kind: "angel", name: g(r, "name"), organisation: g(r, "company"), designation: g(r, "designation"), emails: mails(r, "email 1", "email 2"),
      phone: phoneOf(r["contact no."]), linkedin: linkedinOf(r["linkedin page"]), location: g(r, "location"), status: g(r, "status"), remarks: g(r, "remarks"),
    }) },
  { file: "Firstsales.io - Indian Angel Investor Active on Linkedin.xlsx", sheet: "Sheet1", headerRow: 11, map: (r) => ({
      kind: "angel", name: [g(r, "first_name"), g(r, "last_name")].filter(Boolean).join(" ") || null, organisation: g(r, "company_name"),
      designation: g(r, "headline"), emails: mails(r, "email"), linkedin: linkedinOf(r["linkedin_profile_url"]), website: g(r, "websites"),
      extra: { twitter: g(r, "twitter_url"), school: g(r, "school_name"), degree: g(r, "degree") },
    }) },
  { file: "Retail Investor Database Dump _Linkedin_.xlsx", sheet: "Sheet1", map: (r) => ({
      kind: "angel", name: g(r, "name"), organisation: g(r, "company"), designation: g(r, "designation"), emails: mails(r, "email id"),
      phone: phoneOf(r["phone no."]), linkedin: linkedinOf(r["linkedin url"]),
    }) },
];

const all: DirectoryRecord[] = [];
for (const s of SOURCES) {
  const rows = await readSheet(s.file, s.sheet, s.headerRow);
  const kept = rows.filter((r) => !s.exclude?.(r));
  const recs = kept.flatMap((r) => { const x = toRecord(s.map(r), `${s.file.replace(/\.xlsx$/, "")} / ${s.sheet}`); return x ? [x] : []; });
  all.push(...recs);
  console.log(`${s.file} / ${s.sheet}: ${rows.length} rows, ${rows.length - kept.length} excluded, ${recs.length} usable`);
}
const merged = mergeRecords(all);
console.log(`\n${all.length} usable rows -> ${merged.length} distinct contacts`);
const by = (f: (r: DirectoryRecord) => string) => Object.entries(merged.reduce<Record<string, number>>((a, r) => ((a[f(r)] = (a[f(r)] ?? 0) + 1), a), {}));
console.log("by kind:", JSON.stringify(Object.fromEntries(by((r) => r.kind))));
console.log(`with email: ${merged.filter((r) => r.email).length}, with LinkedIn: ${merged.filter((r) => r.linkedin).length}, with phone: ${merged.filter((r) => r.phone).length}`);
if (dry) { console.log("Dry run: nothing written."); process.exit(0); }

const db = getDb();
const COLS = "dedup_key text, kind text, name text, organisation text, designation text, email text, email2 text, phone text, linkedin text, website text, location text, investor_type text, stage text, sectors text, thesis text, status text, remarks text, extra jsonb, sources text[]";
const NAMES = COLS.split(", ").map((c) => c.split(" ")[0]).join(", ");
for (let i = 0; i < merged.length; i += 1000) {
  await db.query(
    `insert into investor_directory (${NAMES})
     select ${NAMES} from jsonb_to_recordset($1::jsonb) as x(${COLS})
     on conflict (dedup_key) do update set
       sources = (select array(select distinct unnest(investor_directory.sources || excluded.sources))),
       extra = excluded.extra || investor_directory.extra`,
    [JSON.stringify(merged.slice(i, i + 1000))],
  );
}
const { rows } = await db.query<{ n: string }>("select count(*)::text as n from investor_directory");
console.log(`investor_directory now holds ${rows[0]!.n} contacts.`);
await db.close();
