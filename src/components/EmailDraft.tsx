import { Envelope } from "@phosphor-icons/react/dist/ssr";
import { composeEmail, subjectFor } from "@/lib/draft";
import { CopyButton } from "./CopyButton";

/** The pieces of a draft email. Pure, so it is tested without a browser. */
export function draftLinks(o: { to?: string | null; subject: string; body: string }) {
  const to = (o.to ?? "").trim();
  const q = `subject=${encodeURIComponent(o.subject)}&body=${encodeURIComponent(o.body)}`;
  return {
    mailto: `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?${q}`,
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(o.subject)}&body=${encodeURIComponent(o.body)}`,
  };
}

/**
 * "Open in email app / Gmail" opens the founder's OWN mailbox with the recipient, subject and the whole email filled in (greeting,
 * why this investor, a brief about the startup, a meeting link, sign-off). This application never sends mail: nothing leaves until
 * the founder reads the draft and presses send. Pass `angle` (the opening line) or `body` (an email already composed).
 */
export function EmailDraft({ to, angle, body, firm = "", kind = "vc_firm", demo = false }: { to?: string | null; angle?: string; body?: string; firm?: string; kind?: string; demo?: boolean }) {
  const composed = body === undefined ? composeEmail({ opening: angle ?? "", firm, kind }) : { subject: subjectFor(), body };
  const { mailto, gmail } = draftLinks({ to, subject: demo ? `[DEMO] ${composed.subject}` : composed.subject, body: composed.body });
  const cls = "press inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:text-ink";
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title="Opens your own mail app with this draft. This application never sends email.">
      <a href={mailto} className={cls}><Envelope aria-hidden size={12} weight="bold" /> Open in email app</a>
      <a href={gmail} target="_blank" rel="noopener noreferrer" className={cls}>Open in Gmail<span className="sr-only"> (opens in a new tab)</span></a>
      <CopyButton text={composed.body} />
    </span>
  );
}
