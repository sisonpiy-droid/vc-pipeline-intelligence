import Link from "next/link";
import { ArrowUpRight, CaretDown, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { Empty, PageTitle, Pill } from "@/components/ui";
import { fmtDate, safeHref } from "@/lib/format";
import { fetchNews, NEWS_SOURCES, TOPIC_LABEL, TOPIC_MEANS, type NewsItem, type NewsTopic } from "@/lib/news";

export const dynamic = "force-dynamic";
export const metadata = { title: "Venture capital news" };

type Params = { source?: string; topic?: string; q?: string; mine?: string };
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").slice(0, 80);
const TOPICS = Object.keys(TOPIC_LABEL) as NewsTopic[];

/** A link to this page with some filters changed and the rest kept. */
const href = (cur: Params, change: Partial<Params>) => {
  const next = { ...cur, ...change };
  const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
  return qs ? `/news?${qs}` : "/news";
};

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const groupOf = (days: number) => (days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "Earlier this week" : "Earlier");
const GROUP_ORDER = ["Today", "Yesterday", "Earlier this week", "Earlier"];

const chip = (on: boolean) =>
  `press inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${on ? "border-accent bg-accent/10 font-medium text-ink" : "border-line text-muted hover:border-accent/40 hover:text-ink"}`;

const MATTERS_HELP = "Mentions logistics, supply chain, freight, fleets, warehousing or B2B software: your world.";

function Tags({ n }: { n: NewsItem }) {
  return (
    <span className="mt-2 flex flex-wrap items-center gap-1.5">
      <Pill tone="neutral" title={TOPIC_MEANS[n.topic]}>{TOPIC_LABEL[n.topic]}</Pill>
      {n.matters && <Pill tone="good" title={MATTERS_HELP}>Matters to you</Pill>}
      <Pill tone="info">{n.source}</Pill>
    </span>
  );
}

export default async function News({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const cur: Params = {
    source: NEWS_SOURCES.some((s) => s.id === one(sp.source)) ? one(sp.source) : "",
    topic: TOPICS.includes(one(sp.topic) as NewsTopic) ? one(sp.topic) : "",
    q: one(sp.q).trim(),
    mine: one(sp.mine) === "1" ? "1" : "",
  };
  const { items, status, asOf } = await fetchNews();
  const needle = (cur.q ?? "").toLowerCase();
  const shown = items.filter((n) =>
    (!cur.source || n.sourceId === cur.source) && (!cur.topic || n.topic === cur.topic) && (!cur.mine || n.matters) &&
    (!needle || `${n.title} ${n.text}`.toLowerCase().includes(needle)));
  const failed = status.filter((s) => !s.ok);
  const live = status.filter((s) => s.ok).length;
  const mine = items.filter((n) => n.matters).length;

  // "Read these first": the highest-ranked stories of what is shown. The rest follow, newest first, grouped by day.
  const top = [...shown].sort((a, b) => b.rank - a.rank || b.published.localeCompare(a.published)).slice(0, 4);
  const topIds = new Set(top.map((n) => n.id));
  const rest = shown.filter((n) => !topIds.has(n.id));
  const groups = GROUP_ORDER.map((g) => ({ g, rows: rest.filter((n) => groupOf(dayDiff(n.published, asOf)) === g) })).filter((x) => x.rows.length);
  const filtered = Boolean(cur.source || cur.topic || cur.q || cur.mine);

  return (
    <>
      <PageTitle
        eyebrow="Industry"
        title="Venture capital news"
        sub="The last three weeks in venture capital, in plain words: who is raising, who is investing and what it means for a first-time founder. This is general news, not about your startup."
      />

      <p className="mb-5 text-sm text-muted">
        <span className="num font-medium text-ink">{items.length}</span> stories from {live} publications, <span className="num font-medium text-ink">{mine}</span> of them about logistics, supply chain or B2B software.
      </p>

      {top.length > 0 && (
        <section aria-labelledby="first-h" className="mb-10">
          <h2 id="first-h" className="mb-3 text-lg font-semibold">Read these first</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {top.map((n) => {
              const url = safeHref(n.url);
              return (
                <li key={n.id} className="flex flex-col rounded-2xl border border-line bg-surface p-4">
                  <span className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-accent">{TOPIC_LABEL[n.topic]}</span>
                  <h3 className="mt-2 line-clamp-4 text-[0.95rem] font-semibold leading-snug">{n.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{TOPIC_MEANS[n.topic]}</p>
                  <p className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-muted">
                    <span>{n.source} · {fmtDate(n.published).replace(/ 20\d\d$/, "")}</span>
                    {n.matters && <Pill tone="good" title={MATTERS_HELP}>Matters to you</Pill>}
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                        Read <ArrowUpRight aria-hidden size={12} weight="bold" /><span className="sr-only"> {n.title} (opens in a new tab)</span>
                      </a>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form action="/news" role="search" className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-xs">
          {(["source", "topic", "mine"] as const).map((k) => cur[k] && <input key={k} type="hidden" name={k} value={cur[k]} />)}
          <label className="relative block flex-1">
            <span className="sr-only">Search the news</span>
            <MagnifyingGlass aria-hidden size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" name="q" defaultValue={cur.q} placeholder="Search the news" className="w-full rounded-full border border-line bg-surface py-1.5 pl-8 pr-3 text-sm" />
          </label>
        </form>
        <Link href={href(cur, { mine: cur.mine ? "" : "1" })} aria-pressed={Boolean(cur.mine)} className={chip(Boolean(cur.mine))}>Only what matters to me<span className="num text-xs text-muted">{mine}</span></Link>
        {filtered && <Link href="/news" className="text-sm font-medium text-accent hover:underline">Clear filters</Link>}
      </div>

      <nav aria-label="Filter by topic" className="mb-2 flex flex-wrap gap-1.5">
        {[{ id: "", name: "All topics", n: items.length }, ...TOPICS.map((t) => ({ id: t, name: TOPIC_LABEL[t], n: items.filter((i) => i.topic === t).length }))].map((v) => (
          <Link key={v.id || "all"} href={href(cur, { topic: v.id })} aria-current={(cur.topic ?? "") === v.id ? "true" : undefined} title={v.id ? TOPIC_MEANS[v.id as NewsTopic] : undefined} className={chip((cur.topic ?? "") === v.id)}>
            {v.name}<span className="num text-xs text-muted">{v.n}</span>
          </Link>
        ))}
      </nav>
      <nav aria-label="Filter by publication" className="mb-3 flex flex-wrap gap-1.5">
        {[{ id: "", name: "All publications", n: items.length }, ...NEWS_SOURCES.map((s) => ({ id: s.id, name: s.name, n: items.filter((i) => i.sourceId === s.id).length }))].map((v) => (
          <Link key={v.id || "all"} href={href(cur, { source: v.id })} aria-current={(cur.source ?? "") === v.id ? "true" : undefined} className={chip((cur.source ?? "") === v.id) + " !px-3 !py-1 !text-xs"}>
            {v.name}<span className="num text-muted">{v.n}</span>
          </Link>
        ))}
      </nav>

      <details className="group mb-6 text-xs">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-medium text-accent [&::-webkit-details-marker]:hidden">
          What do the topics mean? <CaretDown aria-hidden size={11} weight="bold" className="transition-transform duration-300 group-open:rotate-180" />
        </summary>
        <dl className="mt-3 grid max-w-3xl gap-x-6 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
          {TOPICS.map((t) => (
            <div key={t} className="contents">
              <dt className="font-medium">{TOPIC_LABEL[t]}</dt>
              <dd className="text-muted">{TOPIC_MEANS[t]}</dd>
            </div>
          ))}
        </dl>
      </details>

      <p className="mb-6 text-xs leading-relaxed text-muted">
        Updated about every 30 minutes from {NEWS_SOURCES.map((s) => `${s.name} (${s.region})`).join(", ")}.
        {failed.length > 0 && <span className="ml-1 font-medium text-warn">Could not read {failed.map((f) => `${f.name} (${f.note})`).join(", ")}: its stories are missing here, which does not mean it had none.</span>}
      </p>

      {shown.length === 0 ? (
        <Empty title={failed.length === status.length ? "The news sources could not be reached" : "No stories match"}>
          {failed.length === status.length ? "Every feed failed to load just now. Try again in a minute." : "Nothing matched these filters. Try clearing them."}
        </Empty>
      ) : (
        groups.map(({ g, rows }) => (
          <section key={g} aria-label={g} className="mb-8">
            <h2 className="mb-1 text-sm font-semibold text-muted">{g} <span className="num font-normal">({rows.length})</span></h2>
            <ul className="border-t border-line">
              {rows.map((n) => {
                const url = safeHref(n.url);
                return (
                  <li key={n.id}>
                    <details className="group border-b border-line">
                      <summary className="flex cursor-pointer list-none items-start gap-4 py-4 [&::-webkit-details-marker]:hidden">
                        <span className="num w-14 shrink-0 pt-0.5 text-xs leading-snug text-muted">{fmtDate(n.published).replace(/ 20\d\d$/, "")}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.95rem] font-medium leading-snug">{n.title}</span>
                          {n.snippet && <span className="mt-1 line-clamp-2 block text-sm leading-relaxed text-muted">{n.snippet}</span>}
                          <Tags n={n} />
                        </span>
                        <CaretDown aria-hidden size={14} weight="bold" className="mt-1 shrink-0 text-muted transition-transform duration-300 group-open:rotate-180" />
                      </summary>
                      <div className="pb-5 pl-[4.5rem] pr-6">
                        <p className="max-w-[68ch] rounded-lg bg-accent/5 px-3 py-2 text-sm leading-relaxed"><span className="font-medium text-accent">In plain words: </span>{TOPIC_MEANS[n.topic]}</p>
                        <p className="mt-3 max-w-[68ch] text-sm leading-relaxed">{n.text || `${n.source} shares only the headline in its public feed. The full story is on its site.`}</p>
                        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
                          {url && (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
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
          </section>
        ))
      )}
    </>
  );
}
