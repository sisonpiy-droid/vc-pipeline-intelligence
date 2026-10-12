import Link from "next/link";
import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import { CopyButton } from "@/components/CopyButton";
import { PageTitle, Pill } from "@/components/ui";
import { ENDPOINTS, type Endpoint } from "@/lib/apiDocs";
import { integrations } from "@/lib/integrations";
import { MANUAL_COOLDOWN_MIN } from "@/lib/refresh/service";

export const metadata = { title: "API reference" };
export const dynamic = "force-dynamic"; // the integrations panel reads this deployment's environment on every request

const AUTH_TONE = { none: "neutral", cron_secret: "warn", admin_passcode: "info" } as const;
const AUTH_LABEL = { none: "Public", cron_secret: "Secret required", admin_passcode: "Passcode required" } as const;
const VIEWS = [{ key: "", label: "All" }, { key: "none", label: "Public" }, { key: "admin_passcode", label: "Passcode" }, { key: "cron_secret", label: "Secret" }] as const;
const METHOD = { GET: "bg-info-soft text-info", POST: "bg-good-soft text-good", DELETE: "bg-bad-soft text-bad" } as const;

const GROUPS: { title: string; sub: string; match: (p: string) => boolean }[] = [
  { title: "Pipeline and refresh", sub: "Health, the scheduled and manual refresh, and re-scoring.", match: (p) => /^\/api\/(health|cron|refresh|rescore|palette|chat)/.test(p) },
  { title: "Founder data", sub: "The columns a refresh can never write.", match: (p) => p.startsWith("/api/investors") },
  { title: "Startups", sub: "Add a startup, its rubric and its evaluation.", match: (p) => p.startsWith("/api/startups") },
  { title: "Demo mode", sub: "Synthetic accounts only: real data is never touched.", match: (p) => p.startsWith("/api/demo") },
];

const statusTone = (n: number) => (n < 300 ? "bg-good-soft text-good" : n < 500 ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad");

function Label({ children }: { children: React.ReactNode }) {
  return <dt className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-muted">{children}</dt>;
}

function Code({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-neutral-soft px-3 py-2">
      <code className="num min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{children}</code>
      <CopyButton text={children} />
    </div>
  );
}

function EndpointRow({ e }: { e: Endpoint }) {
  const id = `h-${e.method}-${e.path}`;
  return (
    <details className="group border-b border-line last:border-b-0">
      <summary className="flex cursor-pointer list-none items-start gap-3.5 py-4 [&::-webkit-details-marker]:hidden">
        <span className={`num mt-0.5 w-16 shrink-0 rounded-md px-2 py-0.5 text-center text-[0.7rem] font-semibold ${METHOD[e.method]}`}>{e.method}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.95rem] font-medium leading-snug">{e.plain}</span>
          <h3 id={id} className="num mt-1 text-xs font-normal text-muted">{e.path}</h3>
        </span>
        <span className="flex shrink-0 items-center gap-2"><Pill tone={AUTH_TONE[e.auth.kind]}>{AUTH_LABEL[e.auth.kind]}</Pill><CaretDown aria-hidden size={13} weight="bold" className="text-muted transition-transform duration-300 group-open:rotate-180" /></span>
      </summary>
      <div className="pb-6 sm:pl-[4.75rem]">
        <p className="max-w-[68ch] text-sm leading-relaxed">{e.story}</p>
        <dl className="mt-5 grid gap-x-8 gap-y-4 text-sm md:grid-cols-[9rem_minmax(0,1fr)]">
          <Label>Who can call it</Label>
          <dd className="leading-relaxed text-muted">{e.auth.detail}</dd>
          {e.request && (<><Label>What you send</Label><dd><Code>{e.request}</Code></dd></>)}
          <Label>What you get back</Label>
          <dd>
            <ul className="space-y-1.5">
              {e.responses.map((r) => (
                <li key={r.status} className="flex gap-3">
                  <span className={`num h-fit w-10 shrink-0 rounded-md px-1.5 py-0.5 text-center text-xs font-medium ${statusTone(r.status)}`}>{r.status}</span>
                  <span className="leading-relaxed text-muted">{r.meaning}</span>
                </li>
              ))}
            </ul>
          </dd>
          <Label>Safety limits</Label>
          <dd className="leading-relaxed text-muted">{e.limits}</dd>
          <Label>Technical summary</Label>
          <dd className="leading-relaxed text-muted">{e.summary}</dd>
          {e.example && (<><Label>Try it</Label><dd><Code>{e.example}</Code></dd></>)}
        </dl>
      </div>
    </details>
  );
}

export default async function ApiDocs({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).auth;
  const auth = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const shown = ENDPOINTS.filter((e) => !auth || e.auth.kind === auth);
  return (
    <>
      <PageTitle
        eyebrow="Reference"
        title="API reference"
        sub={`${ENDPOINTS.length} routes. Secrets live only in server-side environment variables; the browser holds none. Manual refreshes are limited to one per ${MANUAL_COOLDOWN_MIN} minutes. Each line says what the route does in plain words: click it for who can call it, what you send, what comes back and the safety limits.`}
      />
      <section aria-labelledby="int-h" className="mb-10">
        <h2 id="int-h" className="text-lg font-semibold tracking-tight">Integrations</h2>
        <p className="mt-1 text-xs text-muted">Names of configured integrations only: secret values never leave the server.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {integrations().map((i) => (
            <li key={i.key} title={i.note} className={`rounded-2xl border px-4 py-3 ${i.state === "configured" ? "border-good/30 bg-good-soft/50" : i.state === "open" ? "border-info/30 bg-info-soft/50" : "border-warn/30 bg-warn-soft/40"}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.95rem] font-medium">{i.name}</span>
                <span className="text-xs font-semibold">{i.state === "configured" ? "Configured" : i.state === "open" ? "Open demo" : "Not set"}</span>
              </div>
              <p className="mt-1 text-xs leading-snug text-muted">{i.note}</p>
            </li>
          ))}
        </ul>
      </section>
      <nav aria-label="Filter by access" className="mb-8 flex flex-wrap gap-1.5">
        {VIEWS.map((v) => {
          const n = v.key ? ENDPOINTS.filter((e) => e.auth.kind === v.key).length : ENDPOINTS.length;
          const on = auth === v.key;
          return (
            <Link key={v.label} href={v.key ? `/api-docs?auth=${v.key}` : "/api-docs"} aria-current={on ? "true" : undefined}
              className={`press inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${on ? "border-accent bg-accent/10 font-medium text-ink" : "border-line text-muted hover:border-accent/40 hover:text-ink"}`}>
              {v.label}<span className="num text-xs text-muted">{n}</span>
            </Link>
          );
        })}
      </nav>
      <dl className="mb-10 grid gap-x-8 gap-y-3 text-sm md:grid-cols-3">
        <div><dt className="flex items-center gap-2 font-medium"><Pill tone="neutral">Public</Pill></dt><dd className="mt-1.5 text-xs leading-relaxed text-muted">Anyone can call it. It reveals only facts the dashboard already shows, never a key or a note.</dd></div>
        <div><dt className="flex items-center gap-2 font-medium"><Pill tone="info">Passcode required</Pill></dt><dd className="mt-1.5 text-xs leading-relaxed text-muted">For actions a person takes in the app (refresh now, edit relationship, add a startup). The browser sends the admin passcode you type; it is never stored. On this open demo site the passcode is switched off, so these work without one.</dd></div>
        <div><dt className="flex items-center gap-2 font-medium"><Pill tone="warn">Secret required</Pill></dt><dd className="mt-1.5 text-xs leading-relaxed text-muted">For machines, not people: the scheduled refresh, its internal hand-off and re-scoring. The caller must send a long server-side secret, which no page or browser ever holds, so these cannot be triggered from the website.</dd></div>
      </dl>
      <div className="space-y-12">
        {GROUPS.map((g) => {
          const list = shown.filter((e) => g.match(e.path));
          if (list.length === 0) return null;
          return (
            <section key={g.title} aria-label={g.title}>
              <div className="mb-1">
                <h2 className="text-sm font-semibold tracking-tight">{g.title}</h2>
                <p className="mt-0.5 text-xs text-muted">{g.sub}</p>
              </div>
              <div className="mt-2 border-t border-line">{list.map((e) => <EndpointRow key={`${e.method} ${e.path}`} e={e} />)}</div>
            </section>
          );
        })}
      </div>
    </>
  );
}
