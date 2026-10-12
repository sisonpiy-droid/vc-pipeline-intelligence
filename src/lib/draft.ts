import { isJunkHeadline } from "@/lib/ai/review";
import { fmtDate } from "@/lib/format";

/**
 * Draft introduction emails. The app never sends them: they open in the founder's own mail app or Gmail, with no address for
 * real investors (their contact details are not stored, and none is invented). Every email has the same shape:
 *   greeting · why I am writing to YOU (from the evidence) · a short brief about the startup · a meeting link · sign-off.
 * The "why you" line is either the Gemini opening angle or a plain line built only from what a source says.
 */

export interface Sender {
  name: string;
  company: string | null;
  brief: string;
  calendly: string;
}

const DEFAULT_BRIEF =
  "We are building B2B SaaS for logistics and supply-chain teams. We are a first-time founding team in India, currently raising a Seed round. [Add one line of traction: customers, pilots or revenue.]";

/**
 * Who is writing, from the server's environment (set in Vercel): FOUNDER_NAME, STARTUP_NAME, STARTUP_BRIEF, CALENDLY_URL.
 * Anything not set stays a visible [placeholder] in the draft, never an invented value.
 */
export function sender(env: Record<string, string | undefined> = process.env): Sender {
  const v = (k: string) => env[k]?.trim() || null;
  const url = v("CALENDLY_URL");
  return {
    name: v("FOUNDER_NAME") ?? "[Your name]",
    company: v("STARTUP_NAME"),
    brief: v("STARTUP_BRIEF") ?? DEFAULT_BRIEF,
    calendly: url && /^https:\/\//i.test(url) ? url : "[your Calendly link]",
  };
}

/** An angel is greeted by first name; a firm, network or accelerator as a team. */
export function greeting(firm: string, kind: string): string {
  if (kind === "angel") return `Hi ${firm.trim().split(/\s+/)[0] || "there"},`;
  return `Hi ${firm.trim() || "there"} team,`;
}

export function subjectFor(s: Sender = sender()): string {
  return s.company ? `Introduction: ${s.company}, Seed-stage B2B logistics SaaS` : "Introduction: Seed-stage B2B logistics SaaS";
}

export function composeEmail(o: { opening: string; firm: string; kind: string; sender?: Sender }): { subject: string; body: string } {
  const s = o.sender ?? sender();
  const body = [
    greeting(o.firm, o.kind),
    o.opening.trim(),
    `A little about us: ${s.brief}`,
    `If this is relevant to what you are looking at, I would value 20 minutes with you. You can pick a time that suits you here: ${s.calendly}`,
    ["Thank you for your time,", s.name, s.company].filter(Boolean).join("\n"),
  ].join("\n\n");
  return { subject: subjectFor(s), body };
}

export interface DraftInput {
  relationship_status: string;
  firm_name?: string;
  entity_type?: string;
  lead: { headline: string; summary: string | null; published_at: string } | null;
}

/** Nobody is emailed again after they passed or committed, or while a reply is awaited. */
const NO_DRAFT = new Set(["passed", "committed", "awaiting_response"]);

/** The "why you" line, from the source alone (its headline, or the summary when the headline is unusable, and its date). */
export function openingFor(r: DraftInput): string | null {
  if (!r.lead || NO_DRAFT.has(r.relationship_status)) return null;
  const what = !isJunkHeadline(r.lead.headline) ? `“${r.lead.headline.replace(/[.\s]+$/, "")}”` : r.lead.summary ? r.lead.summary.replace(/[.\s]+$/, "") : null;
  if (!what) return null;
  return `I came across ${what} (${fmtDate(r.lead.published_at)}), and it made me think of what we are building.`;
}

/** The full email text for an investor with a lead signal but no Gemini-written angle, or null when there is nothing safe to say. */
export function templateDraft(r: DraftInput, s: Sender = sender()): string | null {
  const opening = openingFor(r);
  return opening ? composeEmail({ opening, firm: r.firm_name ?? "", kind: r.entity_type ?? "vc_firm", sender: s }).body : null;
}
