import Link from "next/link";
import { ArrowUpRight, CaretDown } from "@phosphor-icons/react/dist/ssr";
import { Empty, PageTitle, Pill } from "@/components/ui";
import { fmtDate, safeHref } from "@/lib/format";
import { fetchNews, NEWS_SOURCES } from "@/lib/news";

export const dynamic = "force-dynamic";
export const metadata = { title: "Venture capital news" };

export default async function News({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).source;
  const pick = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const source = NEWS_SOURCES.some((s) => s.id === pick) ? pick : "";
  const { items, status } = await fetchNews();
  const shown = source ? items.filter((n) => n.sourceId === source) : items;
  const failed = status.filter((s) => !s.ok);

  return (
    <>
      <PageTitle
        eyebrow="Industry"
        title="Venture capital news"
        sub="What is happening in the market this month: funds, rounds, valuations and investors. It is general news, not specific to your startup. Each story opens to a longer excerpt, with a link to the full article."
      />

      <nav aria-label="Filter by publication" className="mb-3 flex flex-wrap gap-1.5">
        {[{ id: "", name: "All", n: items.length }, ...NEWS_SOURCES.map((s) => ({ id: s.id, name: s.name, n: items.filter((i) => i.sourceId === s.id).length }))].map((v) => {
          const on = source === v.id;
          return (
            <Link key={v.id || "all"} href={v.id ? `/news?source=${v.id}` : "/news"} aria-current={on ? "true" : undefined}
              className={`press inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${on ? "border-accent bg-accent/10 font-medium text-ink" : "border-line text-muted hover:border-accent/40 hover:text-ink"}`}>
              {v.name}<span className="num text-xs text-muted">{v.n}</span>
            </Link>
          );
        })}
      </nav>
      <p className="mb-8 text-xs leading-relaxed text-muted">
        From {NEWS_SOURCES.map((s) => `${s.name} (${s.region})`).join(", ")}. Updated about every 30 minutes; stories from the last three weeks.
        {failed.length > 0 && <span className="ml-1 font-medium text-warn">Could not read {failed.map((f) => `${f.name} (${f.note})`).join(", ")}: its stories are missing here, which does not mean it had none.</span>}
      </p>

      {shown.length === 0 ? (
        <Empty title={failed.length === status.length ? "The news sources could not be reached" : "No venture capital stories in the last three weeks"}>
          {failed.length === status.length ? "Every feed failed to load just now. Try again in a minute." : "Nothing matched for this filter. Try All."}
        </Empty>
      ) : (
        <ul className="border-t border-line">
          {shown.map((n) => {
            const href = safeHref(n.url);
            return (
              <li key={n.id}>
                <details className="group border-b border-line">
                  <summary className="flex cursor-pointer list-none items-start gap-4 py-4 [&::-webkit-details-marker]:hidden">
                    <span className="num w-14 shrink-0 pt-0.5 text-xs leading-snug text-muted">{fmtDate(n.published).replace(/ 20\d\d$/, "")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.95rem] font-medium leading-snug">{n.title}</span>
                      {n.snippet && <span className="mt-1 line-clamp-2 block text-sm leading-relaxed text-muted">{n.snippet}</span>}
                      <span className="mt-2 flex flex-wrap items-center gap-1.5"><Pill tone="info">{n.source}</Pill><Pill tone="neutral">{n.region}</Pill></span>
                    </span>
                    <CaretDown aria-hidden size={14} weight="bold" className="mt-1 shrink-0 text-muted transition-transform duration-300 group-open:rotate-180" />
                  </summary>
                  <div className="pb-5 pl-[4.5rem] pr-6">
                    <p className="max-w-[68ch] text-sm leading-relaxed">{n.text || `${n.source} shares only the headline in its public feed. The full story is on its site.`}</p>
                    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
                      {href && (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                          Read the full story at {n.source} <ArrowUpRight aria-hidden size={12} weight="bold" /><span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      )}
                      <span>Published {fmtDate(n.published)}. This is the publisher&rsquo;s own feed excerpt.</span>
                    </p>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
