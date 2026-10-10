import Link from "next/link";
import { SignalCard } from "@/components/SignalCard";
import { Empty, PageTitle, SetupError } from "@/components/ui";
import { TYPE_LABEL } from "@/lib/format";
import { load, pick, today } from "@/lib/page";
import { listSignals } from "@/lib/read";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signals" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const SHOW = { relevant: "Relevant to logistics / B2B SaaS", verified: "All verified signals", review: "Needs review" } as const;

export default async function Signals({ searchParams }: Props) {
  const f = pick(await searchParams, ["show", "category"]);
  const show = (f.show && f.show in SHOW ? f.show : "relevant") as keyof typeof SHOW;
  const res = await load((db) => listSignals(db, today(), { show, category: f.category }));
  if (!res.ok) return <SetupError message={res.error} />;

  return (
    <>
      <PageTitle
        title="Signal intelligence feed"
        sub="Individual pieces of public evidence from the last 30 days. Each one links to its source, shows the date it happened and when it was retrieved, and quotes the passage that supports it."
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
        <label className="block text-xs font-medium text-muted">
          Show
          <select name="show" defaultValue={show} className="mt-1 block rounded-md border border-line bg-bg px-2 py-1.5 text-sm text-ink">
            {Object.entries(SHOW).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-muted">
          Category
          <select name="category" defaultValue={f.category ?? ""} className="mt-1 block rounded-md border border-line bg-bg px-2 py-1.5 text-sm text-ink">
            <option value="">All</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white dark:text-black">Apply</button>
        {(f.category || f.show) && <Link href="/signals" className="rounded-md border border-line px-4 py-1.5 text-sm">Reset</Link>}
      </form>

      {res.data.length === 0 ? (
        <Empty title={show === "review" ? "Nothing is waiting for review" : "No signals to show"}>
          {show === "relevant"
            ? "No verified, relevant signal was found in the last 30 days. Switch to “All verified signals” to include off-topic items, or check Quiet investors to see what could and could not be searched."
            : "Signals appear here after a refresh finds and verifies evidence. Nothing is shown as a placeholder."}
        </Empty>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{res.data.length} signal{res.data.length > 1 ? "s" : ""}, newest first.</p>
          <div className="space-y-3">{res.data.map((s) => <SignalCard key={s.id} s={s} />)}</div>
        </>
      )}
    </>
  );
}
