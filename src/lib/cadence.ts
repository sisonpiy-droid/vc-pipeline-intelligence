import type { Tone } from "./format";
import { ageInDays } from "./signals/window";

/**
 * Follow-up cadence: when is it time to nudge, check in, or stop waiting? Derived at read time from the founder's own
 * status and last-contact date; it writes nothing, and it is consistent with the score engine's rule that an
 * "awaiting response" investor is left alone for 14 days.
 */
export type CadenceKind = "wait" | "nudge" | "overdue" | "check_in" | "on_track" | "no_date";

export interface Cadence {
  kind: CadenceKind;
  days: number | null;
  tone: Tone;
  label: string;
  /** True when the founder should act today. */
  due: boolean;
}

export const NUDGE_AFTER_DAYS = 7; // "contacted", no reply yet
export const WAIT_UNTIL_DAYS = 14; // "awaiting response": same threshold the score engine uses to stop saying "wait"
export const CHECK_IN_AFTER_DAYS = 10; // "in conversation", quiet for this long

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function cadence(status: string, lastContact: string | null, today: string): Cadence | null {
  if (!["contacted", "awaiting_response", "in_conversation"].includes(status)) return null;
  if (!lastContact) return { kind: "no_date", days: null, tone: "warn", due: false, label: "Add a last-contact date to track follow-ups" };
  const days = Math.max(0, ageInDays(lastContact, new Date(`${today}T00:00:00Z`)));
  if (status === "in_conversation")
    return days >= CHECK_IN_AFTER_DAYS
      ? { kind: "check_in", days, tone: "warn", due: true, label: `Check in: ${plural(days)} since last contact` }
      : { kind: "on_track", days, tone: "good", due: false, label: `In conversation, last contact ${plural(days)} ago` };
  if (status === "awaiting_response")
    return days > WAIT_UNTIL_DAYS
      ? { kind: "overdue", days, tone: "bad", due: true, label: `No reply in ${plural(days)}: nudge once more or move on` }
      : { kind: "wait", days, tone: "neutral", due: false, label: `Waiting: day ${days} of ${WAIT_UNTIL_DAYS}` };
  // contacted
  if (days > WAIT_UNTIL_DAYS) return { kind: "overdue", days, tone: "bad", due: true, label: `No reply in ${plural(days)}: nudge once more or move on` };
  if (days >= NUDGE_AFTER_DAYS) return { kind: "nudge", days, tone: "warn", due: true, label: `Nudge due: no reply in ${plural(days)}` };
  return { kind: "wait", days, tone: "neutral", due: false, label: `Contacted ${plural(days)} ago: give it until day ${NUDGE_AFTER_DAYS}` };
}
