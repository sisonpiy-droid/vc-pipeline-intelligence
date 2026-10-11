import { PageTitle, Pill } from "@/components/ui";
import { ENDPOINTS } from "@/lib/apiDocs";
import { MANUAL_COOLDOWN_MIN } from "@/lib/refresh/service";

export const metadata = { title: "API reference" };

const AUTH_TONE = { none: "neutral", cron_secret: "warn", admin_passcode: "info" } as const;
const AUTH_LABEL = { none: "Public", cron_secret: "Secret required", admin_passcode: "Passcode required" } as const;

export default function ApiDocs() {
  return (
    <>
      <PageTitle title="API reference" sub={`Every route the server exposes. Secrets live only in server-side environment variables; the browser holds none. Manual refreshes are limited to one per ${MANUAL_COOLDOWN_MIN} minutes.`} />
      <div className="space-y-10">
        {ENDPOINTS.map((e) => (
          <section key={`${e.method} ${e.path}`} aria-labelledby={`h-${e.method}-${e.path}`} className="border-t border-line pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="num rounded-md bg-neutral-soft px-2 py-0.5 text-xs font-medium">{e.method}</span>
              <h2 id={`h-${e.method}-${e.path}`} className="num text-base font-semibold">{e.path}</h2>
              <Pill tone={AUTH_TONE[e.auth.kind]}>{AUTH_LABEL[e.auth.kind]}</Pill>
            </div>
            <p className="mt-3 max-w-[75ch] text-sm leading-relaxed">{e.summary}</p>
            <dl className="mt-4 grid gap-x-8 gap-y-4 text-sm md:grid-cols-[8rem_minmax(0,1fr)]">
              <dt className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-muted">Auth</dt>
              <dd className="leading-relaxed text-muted">{e.auth.detail}</dd>
              {e.request && (<><dt className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-muted">Body</dt><dd><code className="num block overflow-x-auto rounded-lg bg-neutral-soft px-3 py-2 text-xs">{e.request}</code></dd></>)}
              <dt className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-muted">Responses</dt>
              <dd><ul className="space-y-1.5">{e.responses.map((r) => <li key={r.status} className="flex gap-3"><span className="num w-9 shrink-0 font-medium">{r.status}</span><span className="text-muted">{r.meaning}</span></li>)}</ul></dd>
              <dt className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-muted">Limits</dt>
              <dd className="leading-relaxed text-muted">{e.limits}</dd>
              {e.example && (<><dt className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-muted">Example</dt><dd><code className="num block overflow-x-auto rounded-lg bg-neutral-soft px-3 py-2 text-xs">{e.example}</code></dd></>)}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}
