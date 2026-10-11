import { nameKey } from "@/lib/normalize";
import { canonicalUrl } from "@/lib/normalize";
import type { ImportIssue, InvestorRecord } from "./import";

/**
 * Curated aliases (former names, rebrands). Every row must carry the URL of a source that documents the rename —
 * an alias with no citation is rejected, because a wrong alias attributes someone else's news to an investor.
 * Aliases improve recall (search and name matching) and never change identity: the key and display name stay as imported.
 */
export interface AliasRow {
  firm_name: string;
  alias: string;
  source_url: string;
}

export function parseAliasCsv(text: string): { rows: AliasRow[]; issues: ImportIssue[] } {
  const rows: AliasRow[] = [];
  const issues: ImportIssue[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  lines.slice(1).forEach((line, i) => {
    const ref = `aliases.csv:${i + 2}`;
    const [firm, alias, ...rest] = line.split(",").map((c) => c.trim());
    const source = rest.join(",").trim();
    if (!firm || !alias) return void issues.push({ ref, severity: "error", message: "needs firm_name and alias" });
    if (!canonicalUrl(source)) return void issues.push({ ref, severity: "error", message: `alias "${alias}" has no valid source_url; not applied` });
    rows.push({ firm_name: firm, alias, source_url: source });
  });
  return { rows, issues };
}

/** Adds each alias to the matching record (by normalised firm name), flags it, and cites its source. */
export function applyCuratedAliases(records: InvestorRecord[], aliasRows: AliasRow[]): { records: InvestorRecord[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const byKey = new Map(records.map((r) => [r.name_key, r]));
  const taken = new Map<string, string>(); // alias key → owner name_key, to refuse an alias two firms would share
  for (const r of records) [r.name_key, ...r.aliases.map(nameKey)].forEach((k) => taken.set(k, r.name_key));

  const out = records.map((r) => ({ ...r, aliases: [...r.aliases], source_urls: [...r.source_urls], data_flags: [...r.data_flags] }));
  const outByKey = new Map(out.map((r) => [r.name_key, r]));
  for (const a of aliasRows) {
    const rec = outByKey.get(nameKey(a.firm_name));
    if (!rec || !byKey.has(nameKey(a.firm_name))) {
      issues.push({ ref: `alias:${a.alias}`, severity: "warning", message: `no investor named "${a.firm_name}"; alias skipped` });
      continue;
    }
    const k = nameKey(a.alias);
    const owner = taken.get(k);
    if (owner && owner !== rec.name_key) {
      issues.push({ ref: `alias:${a.alias}`, severity: "warning", message: `"${a.alias}" already belongs to another investor; skipped` });
      continue;
    }
    if (!taken.has(k)) {
      rec.aliases.push(a.alias);
      taken.set(k, rec.name_key);
    }
    if (!rec.data_flags.includes("alias_curated")) rec.data_flags.push("alias_curated");
    if (!rec.source_urls.some((u) => canonicalUrl(u) === canonicalUrl(a.source_url))) rec.source_urls.push(a.source_url);
  }
  return { records: out, issues };
}
