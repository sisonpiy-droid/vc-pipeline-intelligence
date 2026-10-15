import { PageTitle, SetupError, Stat } from "@/components/ui";
import Link from "next/link";
import { getDirectoryStats, searchOrganisations } from "@/lib/directoryStats";
import { load } from "@/lib/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investor database" };

const KIND: Record<string, string> = { vc: "VC firms and funds", angel: "Angel investors", family_office: "Family offices", network: "Angel networks", accelerator: "Accelerators and incubators", other: "Other" };
const n = (v: number) => v.toLocaleString("en-IN");
/** The source cells are free text (street addresses, ten sectors in one cell): keep a readable glance of each. */
const place = (s: string | null) => (s && s.length <= 45 ? s : null); // a street address is not a place
const few = (s: string | null, k: number) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, k).join(", ") : null);

export default async function DatabasePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").slice(0, 80);
  const text = one(sp.q).trim(), kind = one(sp.kind) in KIND ? one(sp.kind) : "";
  const res = await load(async (db) => ({ stats: await getDirectoryStats(db), cold: await searchOrganisations(db, { text, kind }) }));
  if (!res.ok) return <SetupError message={res.error} />;
  const d = res.data.stats, cold = res.data.cold;
  const href = (k: string) => (k || text ? `/database?${new URLSearchParams({ ...(k ? { kind: k } : {}), ...(text ? { q: text } : {}) })}` : "/database");
  return (
    <>
      <PageTitle title="Investor database" sub="Beyond the 82 investors tracked every week, a wider database of investor contacts has been combined from several sources. It is held privately: the cold search below lists organisations only, never a person's name, email address, phone number or profile link.">
      </PageTitle>
      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Distinct contacts" value={d.total} hint="after merging duplicates across sources" />
        <Stat label="With an email" value={d.withEmail} />
        <Stat label="With a LinkedIn profile" value={d.withLinkedin} />
        <Stat label="With a phone number" value={d.withPhone} />
      </div>
      <div className="mt-12 grid gap-12 lg:grid-cols-2">
        <section aria-labelledby="k-h" className="min-w-0">
          <h2 id="k-h" className="text-lg font-semibold tracking-tight">By type</h2>
          <dl className="mt-4 divide-y divide-line border-y border-line text-sm">
            {d.byKind.map((k) => <div key={k.kind} className="flex justify-between py-2.5"><dt>{KIND[k.kind] ?? k.kind}</dt><dd className="num text-muted">{n(k.n)}</dd></div>)}
          </dl>
        </section>
        <section aria-labelledby="s-h" className="min-w-0">
          <h2 id="s-h" className="text-lg font-semibold tracking-tight">By source list</h2>
          <dl className="mt-4 divide-y divide-line border-y border-line text-sm">
            {d.bySource.map((s) => <div key={s.source} className="flex justify-between gap-4 py-2.5"><dt className="min-w-0 truncate">{s.source.replace(/ \/ /, ": ")}</dt><dd className="num shrink-0 text-muted">{n(s.n)}</dd></div>)}
          </dl>
          <p className="mt-3 max-w-[60ch] text-xs leading-relaxed text-muted">A contact found in several lists is counted once in the total and once in each list it appears in.</p>
        </section>
      </div>
      <section aria-labelledby="cold-h" className="mt-14">
        <h2 id="cold-h" className="text-lg font-semibold tracking-tight">Cold search</h2>
        <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-muted">Search the wider list by type, place, stage or sector to see who is out there. Read-only: nothing here is scored, refreshed or edited by the app.</p>
        <form action="/database" role="search" className="mt-4 flex flex-wrap items-center gap-3">
          {kind && <input type="hidden" name="kind" value={kind} />}
          <label className="flex-1 sm:max-w-md">
            <span className="sr-only">Search cold investors</span>
            <input type="search" name="q" defaultValue={text} placeholder="family office dubai, fintech seed, logistics…" className="w-full rounded-full border border-line bg-surface px-4 py-2 text-sm" />
          </label>
          <button type="submit" className="press rounded-full bg-accent px-4 py-2 text-sm font-medium text-white dark:text-black">Search</button>
        </form>
        <nav aria-label="Filter by type" className="mt-3 flex flex-wrap gap-1.5">
          {([["", "All types"], ...Object.entries(KIND)] as [string, string][]).map(([k, label]) => (
            <Link key={k || "all"} href={href(k)} aria-current={kind === k ? "true" : undefined} className={`press rounded-full border px-3 py-1 text-xs transition-colors ${kind === k ? "border-accent bg-accent/10 font-medium text-ink" : "border-line text-muted hover:border-accent/40 hover:text-ink"}`}>{label}</Link>
          ))}
        </nav>
        <p className="mt-5 text-sm text-muted"><span className="num font-medium text-ink">{n(cold.orgTotal)}</span> organisation{cold.orgTotal === 1 ? "" : "s"} and <span className="num font-medium text-ink">{n(cold.individuals)}</span> individual investor{cold.individuals === 1 ? "" : "s"} match, {n(cold.contacts)} contact{cold.contacts === 1 ? "" : "s"} in all.{cold.orgTotal > cold.orgs.length && ` Showing the ${cold.orgs.length} with the most contacts.`}</p>
        {cold.orgs.length > 0 && (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {cold.orgs.map((o) => (
              <li key={o.organisation} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3 text-sm">
                <span className="min-w-0 flex-1 break-words">
                  <span className="font-medium">{o.organisation}</span>
                  <span className="mt-0.5 block text-xs text-muted">{[KIND[o.kind] ?? o.kind, place(o.location), few(o.sectors, 4)].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="num shrink-0 text-xs text-muted">{n(o.contacts)} contact{o.contacts === 1 ? "" : "s"}{o.withEmail ? `, ${n(o.withEmail)} with email` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="mt-12 max-w-[70ch] text-sm leading-relaxed text-muted">
        This database is not used by the weekly scoring or by the startup rubrics. It is kept separate on purpose: the pipeline only scores investors that have fresh, source-linked evidence, and nothing here has been verified.
      </p>
    </>
  );
}
