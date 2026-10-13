import type { Queryable } from "@/lib/db";

/**
 * Counts about the private contact directory, nothing else: no name, email, phone or LinkedIn handle ever leaves this query.
 * It is the only code that reads `investor_directory`, and it only aggregates.
 */
export interface DirectoryStats {
  total: number;
  withEmail: number;
  withLinkedin: number;
  withPhone: number;
  byKind: { kind: string; n: number }[];
  bySource: { source: string; n: number }[];
}

export async function getDirectoryStats(q: Queryable): Promise<DirectoryStats> {
  const t = (await q.query<{ total: number; email: number; li: number; phone: number }>(
    `select count(*)::int as total, count(email)::int as email, count(linkedin)::int as li, count(phone)::int as phone from investor_directory`,
  )).rows[0]!;
  const byKind = (await q.query<{ kind: string; n: number }>(`select kind, count(*)::int as n from investor_directory group by kind order by n desc`)).rows;
  const bySource = (await q.query<{ source: string; n: number }>(`select s as source, count(*)::int as n from investor_directory, unnest(sources) s group by s order by n desc`)).rows;
  return { total: t.total, withEmail: t.email, withLinkedin: t.li, withPhone: t.phone, byKind, bySource };
}

export interface ColdOrg { organisation: string; kind: string; location: string | null; investor_type: string | null; stage: string | null; sectors: string | null; website: string | null; contacts: number; withEmail: number }
export interface ColdSearch { orgs: ColdOrg[]; orgTotal: number; individuals: number; contacts: number }

/**
 * Cold search: organisations only. A firm is listed with how many contacts are on file for it and how many have an email; the
 * people themselves (name, email, phone, personal profile) are never selected. Contacts with no organisation are individual angels:
 * they are counted, never listed. Read-only. ponytail: ILIKE over ~30k rows is fine; add a tsvector index if it ever feels slow.
 */
export async function searchOrganisations(q: Queryable, f: { text?: string; kind?: string } = {}): Promise<ColdSearch> {
  // Every word must appear somewhere in the row ("family office dubai"); % and _ in what the visitor types are plain characters.
  const words = (f.text ?? "").trim().slice(0, 80).split(/\s+/).filter(Boolean).slice(0, 5).map((w) => `%${w.replace(/[\\%_]/g, "\\$&")}%`);
  const args = [f.kind || null, ...words];
  const hay = `concat_ws(' ', organisation, investor_type, stage, sectors, thesis, location)`;
  const m = `from investor_directory where ($1::text is null or kind = $1)${words.map((_, i) => ` and ${hay} ilike $${i + 2}`).join("")}`;
  const orgs = (await q.query<ColdOrg & { with_email: number }>(
    `select min(organisation) as organisation, mode() within group (order by kind) as kind, left(min(location), 80) as location, left(min(investor_type), 80) as investor_type,
            left(min(stage), 80) as stage, left(min(sectors), 120) as sectors, left(min(website), 120) as website, count(*)::int as contacts, count(email)::int as "withEmail"
       ${m} and organisation is not null group by lower(organisation) order by contacts desc, min(organisation) limit 25`, args)).rows;
  const t = (await q.query<{ orgs: number; individuals: number; contacts: number }>(
    `select count(distinct lower(organisation))::int as orgs, count(*) filter (where organisation is null)::int as individuals, count(*)::int as contacts ${m}`, args)).rows[0]!;
  return { orgs, orgTotal: t.orgs, individuals: t.individuals, contacts: t.contacts };
}
