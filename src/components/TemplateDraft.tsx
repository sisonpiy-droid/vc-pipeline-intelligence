import { EmailDraft } from "./EmailDraft";
import { Linkified } from "./Linkified";

/** A template draft email (see lib/draft.ts) with the two ways to open it in the founder's own mail app, and a preview. */
export function TemplateDraft({ id, status, to, body, demo = false }: { id: string; status: string; to?: string | null; body: string; demo?: boolean }) {
  return (
    <div className="mt-4 rounded-xl border border-line px-3.5 py-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">Draft email <span className="font-normal">(built from this evidence; edit before sending)</span></span>
        <EmailDraft id={id} status={status} to={to} body={body} demo={demo} />
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs font-medium text-accent">Preview the draft</summary>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink/90"><Linkified text={body} /></pre>
      </details>
      <p className="mt-2 text-[0.7rem] text-muted">
        Opens in your own mail app{to ? ` addressed to ${to}` : " with no address (this app stores no investor contact details)"}. Nothing is sent by this application.
      </p>
    </div>
  );
}
