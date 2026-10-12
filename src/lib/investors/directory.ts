// Cleaning and merging for the private contact directory (migration 0008). Pure functions: scripts/import-directory.ts reads the
// spreadsheets and writes the result. Nothing in the app imports this; the directory is not part of the public product.

export type DirectoryKind = "vc" | "angel" | "family_office" | "network" | "accelerator" | "other";

export interface DirectoryRecord {
  dedup_key: string;
  kind: DirectoryKind;
  name: string | null;
  organisation: string | null;
  designation: string | null;
  email: string | null;
  email2: string | null;
  phone: string | null;
  linkedin: string | null;
  website: string | null;
  location: string | null;
  investor_type: string | null;
  stage: string | null;
  sectors: string | null;
  thesis: string | null;
  status: string | null;
  remarks: string | null;
  extra: Record<string, string>;
  sources: string[];
}

const EMPTY = new Set(["", "-", "--", "—", "na", "n/a", "none", "nan", "null", "not available"]);

/** Trimmed text, or null for blanks and placeholders ("-", "NA", "None"). Non-breaking spaces become plain spaces. */
export function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[ ​]/g, " ").replace(/\s+/g, " ").trim();
  return EMPTY.has(s.toLowerCase()) ? null : s;
}

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
/** Every email address found in a cell (cells sometimes hold two, or text around the address), lowercased. */
export function emailsOf(v: unknown): string[] {
  const s = clean(v);
  return s ? [...new Set((s.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))] : [];
}

/** "9820129961.0" (a number cell) becomes "9820129961"; text keeps its own formatting. */
export function phoneOf(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  return /^\d+\.0$/.test(s) ? s.slice(0, -2) : s;
}

/** A LinkedIn profile as `linkedin.com/in/<handle>`; null when the cell has no handle (a bare domain, a stray backtick). */
export function linkedinOf(v: unknown): string | null {
  const s = clean(v);
  const m = s?.toLowerCase().match(/linkedin\.com\/(in|company|school)\/([^/?#\s`'"]+)/);
  return m ? `linkedin.com/${m[1]}/${m[2]}` : null;
}

/**
 * The Mynt tracker's PLATFORM column says which product a contact was added for. Only "MV" and "MV : MYNT" (MV or Mynt) are kept;
 * rows that are Mynt only, or have no platform, are dropped.
 */
export function keepPlatform(platform: unknown): boolean {
  const p = clean(platform)?.toLowerCase();
  return !!p && /^mv(\s*(:|\/|or)\s*mynt)?$/.test(p);
}

/** Investor-type text from a source ("Accelerator, Incubator, Venture Capital", "Angel network") to one kind. */
export function kindOf(text: string | null, fallback: DirectoryKind): DirectoryKind {
  const t = (text ?? "").toLowerCase();
  if (/family office/.test(t)) return "family_office";
  if (/angel network|network/.test(t)) return "network";
  if (/venture|\bvc\b|private equity/.test(t)) return "vc";
  if (/angel/.test(t)) return "angel";
  if (/accelerator|incubator/.test(t)) return "accelerator";
  return fallback;
}

export function dedupKey(r: Pick<DirectoryRecord, "email" | "linkedin" | "name" | "organisation">): string | null {
  if (r.email) return `e:${r.email}`;
  if (r.linkedin) return `l:${r.linkedin}`;
  if (r.name || r.organisation) return `n:${(r.name ?? "").toLowerCase()}|${(r.organisation ?? "").toLowerCase()}`;
  return null;
}

type Fields = Partial<Omit<DirectoryRecord, "dedup_key" | "kind" | "sources" | "email" | "email2" | "extra">> & {
  kind: DirectoryKind;
  emails?: string[];
  extra?: Record<string, unknown>;
};

/** Builds a record from mapped fields; null when the row has nothing to identify it (no email, handle, name or organisation). */
export function toRecord(f: Fields, source: string): DirectoryRecord | null {
  const [email = null, email2 = null] = f.emails ?? [];
  const base = {
    kind: f.kind,
    name: f.name ?? null,
    organisation: f.organisation ?? null,
    designation: f.designation ?? null,
    email,
    email2,
    phone: f.phone ?? null,
    linkedin: f.linkedin ?? null,
    website: f.website ?? null,
    location: f.location ?? null,
    investor_type: f.investor_type ?? null,
    stage: f.stage ?? null,
    sectors: f.sectors ?? null,
    thesis: f.thesis ?? null,
    status: f.status ?? null,
    remarks: f.remarks ?? null,
    extra: Object.fromEntries(Object.entries(f.extra ?? {}).flatMap(([k, v]) => { const c = clean(v); return c ? [[k, c]] : []; })),
    sources: [source],
  };
  const key = dedupKey(base);
  return key ? { dedup_key: key, ...base } : null;
}

/** One record per dedup key: the first non-empty value of each field wins, and every source is kept. */
export function mergeRecords(list: DirectoryRecord[]): DirectoryRecord[] {
  const out = new Map<string, DirectoryRecord>();
  for (const r of list) {
    const have = out.get(r.dedup_key);
    if (!have) { out.set(r.dedup_key, { ...r, extra: { ...r.extra }, sources: [...r.sources] }); continue; }
    for (const k of Object.keys(r) as (keyof DirectoryRecord)[]) {
      if (k === "sources" || k === "extra" || k === "dedup_key" || k === "kind") continue;
      if (have[k] === null) (have as unknown as Record<string, unknown>)[k] = r[k];
    }
    have.extra = { ...r.extra, ...have.extra };
    have.sources = [...new Set([...have.sources, ...r.sources])];
  }
  return [...out.values()];
}
