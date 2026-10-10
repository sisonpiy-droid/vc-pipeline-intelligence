import { parseDate } from "@/lib/signals/window";

export interface ExtractedPage {
  title: string;
  text: string;
  /** YYYY-MM-DD from the page's own metadata, or null. */
  published_at: string | null;
  /** True when the page's own metadata names two different publication dates. */
  date_conflict: boolean;
  canonical_url: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

function metaContent(html: string, attr: "property" | "name" | "itemprop", names: string[]): string[] {
  const out: string[] = [];
  const re = /<meta\b[^>]*>/gi;
  for (const tag of html.match(re) ?? []) {
    const a = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1]?.toLowerCase();
    if (!a || !names.includes(a)) continue;
    const c = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (c) out.push(decode(c));
  }
  return out;
}

function jsonLdDates(html: string): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      if (typeof o.datePublished === "string") out.push(o.datePublished);
      Object.values(o).forEach(walk);
    }
  };
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1]!));
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  }
  return out;
}

/** Publication-date candidates, strongest first. dateModified / "updated" are intentionally NOT used. */
export function publicationDates(html: string): string[] {
  const raw = [
    ...jsonLdDates(html),
    ...metaContent(html, "property", ["article:published_time", "og:article:published_time"]),
    ...metaContent(html, "name", ["pubdate", "publishdate", "publish_date", "date", "dc.date.issued", "article:published_time", "parsely-pub-date"]),
    ...metaContent(html, "itemprop", ["datepublished"]),
    ...[...html.matchAll(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/gi)].slice(0, 1).map((m) => m[1]!),
  ];
  const parsed = raw.map(parseDate).filter((d): d is string => !!d);
  return parsed;
}

export function extractPage(html: string): ExtractedPage {
  const title = decode(
    metaContent(html, "property", ["og:title"])[0] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "",
  ).replace(/\s+/g, " ").trim();

  const dates = publicationDates(html);
  const first = dates[0] ?? null;
  // Two publication dates more than 2 days apart = contradictory evidence; do not pick one.
  const conflict = !!first && dates.some((d) => Math.abs(Date.parse(d) - Date.parse(first)) > 2 * 86_400_000);

  const canonical = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] ?? null;

  let body = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ?? /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  body = body
    .replace(/<(script|style|noscript|nav|header|footer|aside|form|svg|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decode(body).replace(/[ \t\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, 20_000);

  return { title, text, published_at: conflict ? null : first, date_conflict: conflict, canonical_url: canonical };
}
