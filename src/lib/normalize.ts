/** Identity key for an investor: case, punctuation, diacritics and spacing never create a "new" investor. */
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Artha Venture Fund / Artha Group" → primary + the aliases the source itself provides. */
export function splitAliases(raw: string): { name: string; aliases: string[] } {
  const parts = raw.split(/\s+\/\s+/).map((p) => p.trim()).filter(Boolean);
  return { name: parts[0] ?? raw.trim(), aliases: parts.slice(1) };
}

/** "Logistics, B2B SaaS; deeptech" → ["Logistics","B2B SaaS","deeptech"], case-insensitively de-duplicated. */
export function splitList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;]/)) {
    const v = part.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|source|igshid|_hsenc|_hsmi)$/i;

/**
 * Canonical form of a URL for de-duplication: https, lower-case host without "www.", no fragment,
 * no tracking params, sorted query, no trailing slash. Returns null for anything that is not http(s).
 */
export function canonicalUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.protocol = "https:";
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  if (u.port === "443" || u.port === "80") u.port = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  let out = u.toString();
  if (u.pathname !== "/" || u.search) out = out.replace(/\/+(?=\?|$)/, "");
  else out = out.replace(/\/$/, "");
  return out;
}
