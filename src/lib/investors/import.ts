import { z } from "zod";
import type { Db } from "@/lib/db";
import { canonicalUrl, nameKey, splitAliases, splitList } from "@/lib/normalize";

/** Everything the importer may hand to the database. Signal-derived columns are deliberately absent. */
export interface InvestorRecord {
  entity_type: "vc_firm" | "angel" | "network" | "accelerator";
  entity_type_source: "sheet" | "heuristic";
  name_key: string;
  firm_name: string;
  aliases: string[];
  role_title: string | null;
  website_url: string | null;
  profile_url: string | null;
  fit_rationale: string | null;
  sectors: string[];
  stage_preference: string | null;
  geography: string | null;
  notable_investments: string[];
  source_urls: string[];
  source_ref: string;
  verification_status: "unverified" | "source_reviewed";
  verification_note: string | null;
  data_flags: string[];
  // Founder-owned: used on FIRST insert only, never on update.
  partner_name: string | null;
  partner_profile_url: string | null;
  last_contact_date: string | null;
  relationship_status: RelationshipStatus;
  contact_history: unknown[];
  personal_notes: string | null;
}

export type RelationshipStatus =
  | "not_contacted" | "contacted" | "in_conversation" | "awaiting_response" | "passed" | "committed";

export interface ImportIssue {
  ref: string;
  severity: "error" | "warning";
  message: string;
}

type SheetRow = Record<string, unknown>;

// ───────────────────────────── parsing ─────────────────────────────

const text = z.preprocess((v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}, z.string().nullable());

const vcRow = z.object({
  firm_name: z.string().trim().min(1),
  website_url: text,
  profile_or_portfolio_url: text,
  stage_preference_initial: text,
  sector_tags_initial: text,
  fit_rationale: text,
  verification_status: text,
  partner_name: text,
  partner_profile_url: text,
  geography: text,
  thesis_verified: text,
  last_contact_date: text,
  relationship_status: text,
  contact_history: text,
  personal_notes: text,
  last_signal_date: text,
  signal_summary: text,
  follow_up_score: text,
  recommended_action: text,
});

const angelRow = z.object({
  angel_id: z.string().trim().min(1),
  angel_name: z.string().trim().min(1),
  current_role: text,
  sector_tags_initial: text,
  notable_investments_initial: text,
  geography: text,
  profile_url: text,
  source_directory_url: text,
  verification_status: text,
  last_contact_date: text,
  relationship_status: text,
  contact_history: text,
  personal_notes: text,
  last_signal_date: text,
  signal_summary: text,
  follow_up_score: text,
  recommended_action: text,
});

function relationship(raw: string | null): { status: RelationshipStatus; placeholder: boolean } {
  const s = (raw ?? "").toLowerCase();
  const placeholder = /demo default|replace with real data/.test(s);
  if (/not contacted|^$/.test(s)) return { status: "not_contacted", placeholder };
  if (/await|pending|waiting/.test(s)) return { status: "awaiting_response", placeholder };
  if (/conversation|meeting|talking/.test(s)) return { status: "in_conversation", placeholder };
  if (/passed|declined/.test(s)) return { status: "passed", placeholder };
  if (/committed|term sheet/.test(s)) return { status: "committed", placeholder };
  if (/contacted/.test(s)) return { status: "contacted", placeholder };
  return { status: "not_contacted", placeholder };
}

function isoDate(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function contactHistory(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* free text — keep it verbatim rather than lose it */
  }
  return [{ date: null, note: raw }];
}

function urlOrNull(raw: string | null, flags: string[], flag: string): string | null {
  if (!raw) return null;
  if (canonicalUrl(raw)) return raw;
  flags.push(flag);
  return null;
}

/** The workbook has no entity-type column; infer networks/accelerators from the text, and say so. */
function inferVcEntity(name: string, stage: string | null, note: string | null): InvestorRecord["entity_type"] | null {
  const hay = `${name} ${stage ?? ""} ${note ?? ""}`.toLowerCase();
  if (/accelerator/.test(hay)) return "accelerator";
  if (/\bnetwork\b|investor-network|\bangels?\b|letsventure/.test(hay)) return "network";
  return null;
}

function founderOwned(r: z.infer<typeof vcRow> | z.infer<typeof angelRow>, flags: string[]) {
  const rel = relationship(r.relationship_status);
  if (rel.placeholder) flags.push("relationship_status_placeholder");
  return {
    partner_name: "partner_name" in r ? r.partner_name : null,
    partner_profile_url: "partner_profile_url" in r ? r.partner_profile_url : null,
    last_contact_date: isoDate(r.last_contact_date),
    relationship_status: rel.status,
    contact_history: contactHistory(r.contact_history),
    personal_notes: r.personal_notes,
  };
}

export function parseWorkbookRows(vcRows: SheetRow[], angelRows: SheetRow[]): { records: InvestorRecord[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const candidates: InvestorRecord[] = [];

  vcRows.forEach((raw, i) => {
    const ref = `VC Firms!row ${i + 2}`;
    const p = vcRow.safeParse(raw);
    if (!p.success) return void issues.push({ ref, severity: "error", message: `invalid row: ${p.error.issues.map((x) => x.path.join(".") + " " + x.message).join("; ")}` });
    const r = p.data;
    const flags: string[] = [];
    const { name, aliases } = splitAliases(r.firm_name);
    if (typeof raw.firm_name === "string" && raw.firm_name !== raw.firm_name.trim()) flags.push("name_cleaned");
    if (aliases.length) flags.push("alias_split");
    const inferred = inferVcEntity(name, r.stage_preference_initial, r.verification_status);
    if (inferred) flags.push("entity_type_heuristic");
    if (r.geography?.includes("(confirm)")) flags.push("geography_unconfirmed");
    if (!r.thesis_verified?.toLowerCase().startsWith("yes")) flags.push("thesis_unverified");
    if (!r.partner_name) flags.push("partner_unknown");
    if (r.last_signal_date || r.signal_summary || r.follow_up_score || r.recommended_action)
      issues.push({ ref, severity: "warning", message: "workbook signal-derived columns are ignored: they are computed by the refresh, never imported" });
    const website = urlOrNull(r.website_url, flags, "website_url_invalid");
    const profile = urlOrNull(r.profile_or_portfolio_url, flags, "profile_url_invalid");
    if (!website) flags.push("no_website");

    candidates.push({
      entity_type: inferred ?? "vc_firm",
      entity_type_source: inferred ? "heuristic" : "sheet",
      name_key: nameKey(name),
      firm_name: name,
      aliases,
      role_title: null,
      website_url: website,
      profile_url: profile,
      fit_rationale: r.fit_rationale,
      sectors: splitList(r.sector_tags_initial),
      stage_preference: r.stage_preference_initial,
      geography: r.geography?.replace(/\s*\(confirm\)/i, "").trim() || null,
      notable_investments: [],
      source_urls: uniqueByCanonical([website, profile]),
      source_ref: ref,
      verification_status: /^official .*reviewed$/i.test(r.verification_status ?? "") ? "source_reviewed" : "unverified",
      verification_note: r.verification_status,
      data_flags: flags,
      ...founderOwned(r, flags),
    });
  });

  angelRows.forEach((raw, i) => {
    const ref = String(raw.angel_id ?? `Angel Investors!row ${i + 2}`);
    const p = angelRow.safeParse(raw);
    if (!p.success) return void issues.push({ ref, severity: "error", message: `invalid row: ${p.error.issues.map((x) => x.path.join(".") + " " + x.message).join("; ")}` });
    const r = p.data;
    const flags: string[] = ["no_website", "partner_unknown"];
    if (r.geography?.includes("(confirm)")) flags.push("geography_unconfirmed");
    flags.push("thesis_unverified");
    if (r.last_signal_date || r.signal_summary || r.follow_up_score || r.recommended_action)
      issues.push({ ref, severity: "warning", message: "workbook signal-derived columns are ignored" });
    const profile = urlOrNull(r.profile_url, flags, "profile_url_invalid");
    const directory = urlOrNull(r.source_directory_url, flags, "source_url_invalid");

    candidates.push({
      entity_type: "angel",
      entity_type_source: "sheet",
      name_key: nameKey(r.angel_name),
      firm_name: r.angel_name,
      aliases: [],
      role_title: r.current_role,
      website_url: null,
      profile_url: profile,
      fit_rationale: null,
      sectors: splitList(r.sector_tags_initial),
      stage_preference: null,
      geography: r.geography?.replace(/\s*\(confirm\)/i, "").trim() || null,
      notable_investments: splitList(r.notable_investments_initial),
      source_urls: uniqueByCanonical([profile, directory]),
      source_ref: ref,
      verification_status: "unverified",
      verification_note: r.verification_status,
      data_flags: flags,
      ...founderOwned(r, flags),
    });
  });

  return { records: dropDuplicates(candidates, issues), issues };
}

function uniqueByCanonical(urls: (string | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const c = canonicalUrl(u);
    if (u && c && !seen.has(c)) {
      seen.add(c);
      out.push(u);
    }
  }
  return out;
}

/** Two rows that share a name or alias key are one investor: keep the first, report the rest. */
function dropDuplicates(records: InvestorRecord[], issues: ImportIssue[]): InvestorRecord[] {
  const owner = new Map<string, InvestorRecord>();
  const kept: InvestorRecord[] = [];
  for (const rec of records) {
    const keys = [rec.name_key, ...rec.aliases.map(nameKey)];
    const clash = keys.map((k) => owner.get(k)).find(Boolean);
    if (clash) {
      issues.push({ ref: rec.source_ref, severity: "warning", message: `duplicate of "${clash.firm_name}" (${clash.source_ref}); skipped` });
      continue;
    }
    keys.forEach((k) => owner.set(k, rec));
    kept.push(rec);
  }
  return kept;
}

// ───────────────────────────── persistence ─────────────────────────────

export interface ImportResult {
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: ImportIssue[];
}

/**
 * Idempotent upsert keyed on name_key.
 *  - INSERT writes every field (founder-owned ones get the workbook's initial value).
 *  - ON CONFLICT updates PROFILE columns only. Identity (name_key, firm_name, entity_type),
 *    founder-owned columns, signal-derived columns, investment_thesis and thesis_verified are not in
 *    the SET list, so a re-import can never overwrite them. `verification_status` can never be
 *    downgraded from 'verified'.
 *  - Rows whose profile columns are unchanged are not touched at all (stable updated_at).
 */
export async function importInvestors(db: Db, records: InvestorRecord[]): Promise<ImportResult> {
  const res: ImportResult = { inserted: 0, updated: 0, unchanged: 0, skipped: [] };

  // Guard against a name/alias that collides with an investor already in the database under another key.
  const existing = (await db.query<{ name_key: string; aliases: string[]; firm_name: string }>(
    "select name_key, aliases, firm_name from investors",
  )).rows;
  const byKey = new Map<string, string>();
  for (const e of existing) [e.name_key, ...e.aliases.map(nameKey)].forEach((k) => byKey.set(k, e.name_key));

  await db.tx(async (q) => {
    for (const r of records) {
      const clash = [r.name_key, ...r.aliases.map(nameKey)].map((k) => byKey.get(k)).find((k) => k && k !== r.name_key);
      if (clash) {
        res.skipped.push({ ref: r.source_ref, severity: "warning", message: `"${r.firm_name}" matches existing investor key "${clash}" — resolve manually` });
        continue;
      }
      const out = await q.query<{ inserted: boolean }>(
        `insert into investors (
           entity_type, entity_type_source, name_key, firm_name, aliases, role_title, website_url, profile_url,
           fit_rationale, sectors, stage_preference, geography, notable_investments, source_urls, source_ref,
           verification_status, verification_note, data_flags,
           partner_name, partner_profile_url, last_contact_date, relationship_status, contact_history, personal_notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24)
         on conflict (name_key) do update set
           aliases = excluded.aliases, role_title = excluded.role_title,
           website_url = excluded.website_url, profile_url = excluded.profile_url,
           fit_rationale = excluded.fit_rationale, sectors = excluded.sectors,
           stage_preference = excluded.stage_preference, geography = excluded.geography,
           notable_investments = excluded.notable_investments, source_urls = excluded.source_urls,
           source_ref = excluded.source_ref, verification_note = excluded.verification_note,
           data_flags = excluded.data_flags,
           verification_status = case when investors.verification_status = 'verified'
                                      then 'verified' else excluded.verification_status end
         where (investors.aliases, investors.role_title, investors.website_url, investors.profile_url,
                investors.fit_rationale, investors.sectors, investors.stage_preference, investors.geography,
                investors.notable_investments, investors.source_urls, investors.source_ref,
                investors.verification_note, investors.data_flags, investors.verification_status)
               is distinct from
               (excluded.aliases, excluded.role_title, excluded.website_url, excluded.profile_url,
                excluded.fit_rationale, excluded.sectors, excluded.stage_preference, excluded.geography,
                excluded.notable_investments, excluded.source_urls, excluded.source_ref,
                excluded.verification_note, excluded.data_flags,
                case when investors.verification_status = 'verified' then 'verified' else excluded.verification_status end)
         returning (xmax = 0) as inserted`,
        [
          r.entity_type, r.entity_type_source, r.name_key, r.firm_name, r.aliases, r.role_title, r.website_url, r.profile_url,
          r.fit_rationale, r.sectors, r.stage_preference, r.geography, r.notable_investments, r.source_urls, r.source_ref,
          r.verification_status, r.verification_note, r.data_flags,
          r.partner_name, r.partner_profile_url, r.last_contact_date, r.relationship_status, JSON.stringify(r.contact_history), r.personal_notes,
        ],
      );
      if (out.rows.length === 0) res.unchanged++;
      else if (out.rows[0]!.inserted) res.inserted++;
      else res.updated++;
    }
  });
  return res;
}
