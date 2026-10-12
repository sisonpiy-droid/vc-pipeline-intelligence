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
