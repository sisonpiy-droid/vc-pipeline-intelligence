import { composeEmail, subjectFor } from "@/lib/draft";
import { isOpenDemo } from "@/lib/demo";
import { MailActions } from "./MailActions";

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
 * "Send mail / Gmail" opens the founder's OWN mailbox with the recipient, subject and the whole email filled in (greeting, why this
 * investor, a brief about the startup, a meeting link, sign-off). This application never sends mail: nothing leaves until the founder
 * reads the draft and presses send. Pass `angle` (the opening line) or `body` (an email already composed).
 */
export function EmailDraft({ id, status, to, angle, body, firm = "", kind = "vc_firm", demo = false }: {
  id: string; status: string; to?: string | null; angle?: string; body?: string; firm?: string; kind?: string; demo?: boolean;
}) {
  const composed = body === undefined ? composeEmail({ opening: angle ?? "", firm, kind }) : { subject: subjectFor(), body };
  const { mailto, gmail } = draftLinks({ to, subject: demo ? `[DEMO] ${composed.subject}` : composed.subject, body: composed.body });
  return <MailActions id={id} body={composed.body} mailto={mailto} gmail={gmail} status={status} tracked={isOpenDemo()} />;
}
