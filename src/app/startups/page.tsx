import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { Empty, Pill, PageTitle, SetupError } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { load } from "@/lib/page";
import { listStartups } from "@/lib/startups/store";
import { STAGE_LABEL } from "@/lib/startups/rubric";

export const dynamic = "force-dynamic";
export const metadata = { title: "Startups" };

export default async function StartupsPage() {
  const res = await load((db) => listStartups(db));
  if (!res.ok) return <SetupError message={res.error} />;
  const list = res.data;
  return (
    <>
      <PageTitle title="Startups" sub="Each startup gets its own scoring rubric and its own ranking of the same investors. Add one, review the rubric Gemini writes for it, and see the exact workflow.">
        <Link href="/startups/new" className="press rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white dark:text-black">Add a startup</Link>
      </PageTitle>

      <ul className="divide-y divide-line border-y border-line">
        <li>
          <Link href="/" className="group flex flex-wrap items-center justify-between gap-3 px-1 py-5 hover:bg-neutral-soft/40">
            <div>
              <p className="font-medium">Main workspace: Seed-stage B2B logistics SaaS</p>
              <p className="mt-1 text-sm text-muted">The founder&rsquo;s own startup, with its relationship notes and live refreshes. This is the dashboard you already know.</p>
            </div>
            <span className="inline-flex items-center gap-1 text-sm text-accent">Open <ArrowRight aria-hidden size={14} weight="bold" /></span>
          </Link>
        </li>
        {list.map((s) => (
          <li key={s.id}>
            <Link href={`/startups/${s.slug}`} className="group flex flex-wrap items-center justify-between gap-3 px-1 py-5 hover:bg-neutral-soft/40">
              <div className="min-w-0">
                <p className="font-medium">{s.name}</p>
                <p className="mt-1 max-w-[70ch] truncate text-sm text-muted">{s.pitch}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{s.sector}</span><span aria-hidden>·</span><span>{STAGE_LABEL[s.stage]}</span><span aria-hidden>·</span><span>{s.geography}</span><span aria-hidden>·</span><span>added {fmtDate(s.created_at)}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={s.rubric_source === "default" ? "warn" : "info"} title="Where this startup's rubric came from">{s.rubric_source === "gemini" ? "Gemini rubric" : s.rubric_source === "edited" ? "Edited rubric" : "Default rubric"}</Pill>
                {s.scored > 0 ? <Pill tone="good">{s.reach_out} reach out now · {s.scored} scored</Pill> : <Pill tone="neutral">Not evaluated yet</Pill>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {list.length === 0 && (
        <div className="mt-8">
          <Empty title="No other startups yet" action={<Link href="/startups/new" className="press rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white dark:text-black">Add your first</Link>}>
            Describe a startup in a few lines. Gemini drafts its rubric, and you will see every step before anything is scored.
          </Empty>
        </div>
      )}
    </>
  );
}
