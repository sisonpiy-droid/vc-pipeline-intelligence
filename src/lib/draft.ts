import { isJunkHeadline } from "@/lib/ai/review";
import { fmtDate } from "@/lib/format";

/**
 * A plain template draft for any investor that has a lead signal but no Gemini-written opening line. It uses only what the source
 * says (its headline, or the summary when the headline is unusable, and its date) and makes no claim about the investor. It is a
 * starting point to edit, never advice, and the app never sends it: it opens in the founder's own mail app, with no address for
 * real investors (their contact details are not stored, and none is invented).
 */
export interface DraftInput {
  relationship_status: string;
  lead: { headline: string; summary: string | null; published_at: string } | null;
}

/** Nobody is emailed again after they passed or committed, or while a reply is awaited. */
const NO_DRAFT = new Set(["passed", "committed", "awaiting_response"]);

export function templateDraft(r: DraftInput): string | null {
  if (!r.lead || NO_DRAFT.has(r.relationship_status)) return null;
  const what = !isJunkHeadline(r.lead.headline) ? `“${r.lead.headline.replace(/[.\s]+$/, "")}”` : r.lead.summary ? r.lead.summary.replace(/[.\s]+$/, "") : null;
  if (!what) return null;
  return `Hello,\n\nI came across ${what} (${fmtDate(r.lead.published_at)}). I am raising a Seed round for a B2B logistics SaaS and thought it might be relevant to what you are looking at. Would you be open to a short conversation?\n\n[Your name]`;
}
