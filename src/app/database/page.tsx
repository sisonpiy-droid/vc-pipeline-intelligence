import { PageTitle, SetupError, Stat } from "@/components/ui";
import { getDirectoryStats } from "@/lib/directoryStats";
import { load } from "@/lib/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investor database" };

const KIND: Record<string, string> = { vc: "VC firms and funds", angel: "Angel investors", family_office: "Family offices", network: "Angel networks", accelerator: "Accelerators and incubators", other: "Other" };
const n = (v: number) => v.toLocaleString("en-IN");

export default async function DatabasePage() {
  const res = await load((db) => getDirectoryStats(db));
  if (!res.ok) return <SetupError message={res.error} />;
  const d = res.data;
  return (
    <>
      <PageTitle title="Investor database" sub="Beyond the 82 investors tracked every week, a wider database of investor contacts has been combined from several sources. It is held privately: only counts are shown here, never a name, email address, phone number or profile link.">
      </PageTitle>
      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Distinct contacts" value={d.total} hint="after merging duplicates across sources" />
        <Stat label="With an email" value={d.withEmail} />
        <Stat label="With a LinkedIn profile" value={d.withLinkedin} />
        <Stat label="With a phone number" value={d.withPhone} />
      </div>
      <div className="mt-12 grid gap-12 lg:grid-cols-2">
        <section aria-labelledby="k-h">
          <h2 id="k-h" className="text-lg font-semibold tracking-tight">By type</h2>
          <dl className="mt-4 divide-y divide-line border-y border-line text-sm">
            {d.byKind.map((k) => <div key={k.kind} className="flex justify-between py-2.5"><dt>{KIND[k.kind] ?? k.kind}</dt><dd className="num text-muted">{n(k.n)}</dd></div>)}
          </dl>
        </section>
        <section aria-labelledby="s-h">
          <h2 id="s-h" className="text-lg font-semibold tracking-tight">By source list</h2>
          <dl className="mt-4 divide-y divide-line border-y border-line text-sm">
            {d.bySource.map((s) => <div key={s.source} className="flex justify-between gap-4 py-2.5"><dt className="min-w-0 truncate">{s.source.replace(/ \/ /, ": ")}</dt><dd className="num shrink-0 text-muted">{n(s.n)}</dd></div>)}
          </dl>
          <p className="mt-3 max-w-[60ch] text-xs leading-relaxed text-muted">A contact found in several lists is counted once in the total and once in each list it appears in.</p>
        </section>
      </div>
      <p className="mt-12 max-w-[70ch] text-sm leading-relaxed text-muted">
        This database is not used by the weekly scoring or by the startup rubrics. It is kept separate on purpose: the pipeline only scores investors that have fresh, source-linked evidence, and nothing here has been verified.
      </p>
    </>
  );
}
