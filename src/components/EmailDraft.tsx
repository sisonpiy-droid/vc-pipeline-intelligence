import { Envelope } from "@phosphor-icons/react/dist/ssr";

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
 * "Email this draft" opens the founder's OWN mail app (or Gmail) with the recipient, subject and text filled in. This application
 * never sends mail: nothing leaves until the founder reads the draft and presses send in their own mailbox.
 */
export function introDraft(angle: string) {
  return { subject: "Introduction: Seed-stage B2B logistics SaaS", body: `${angle}\n\n[Your name]` };
}

export function EmailDraft({ to, angle, body, demo = false }: { to?: string | null; angle: string; body?: string; demo?: boolean }) {
  const d = introDraft(angle);
  const { mailto, gmail } = draftLinks({ to, subject: demo ? `[DEMO] ${d.subject}` : d.subject, body: body ?? d.body });
  const cls = "press inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:text-ink";
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title="Opens your own mail app with this draft. This application never sends email.">
      <a href={mailto} className={cls}><Envelope aria-hidden size={12} weight="bold" /> Open in email app</a>
      <a href={gmail} target="_blank" rel="noopener noreferrer" className={cls}>Open in Gmail<span className="sr-only"> (opens in a new tab)</span></a>
    </span>
  );
}
