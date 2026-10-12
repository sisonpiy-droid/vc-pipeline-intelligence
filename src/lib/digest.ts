import { cadence } from "./cadence";
import { greeting } from "./format";
import { topPicks } from "./picks";
import type { PipelineRow } from "./read";

const HOLD = (r: PipelineRow) => r.recommended_action === "wait_for_response" || r.relationship_status === "passed" || r.relationship_status === "committed";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * The daily Telegram report: plain text, short enough to read on a lock screen. It carries firm names, scores and the
 * public headline only. Never contact history, notes or email addresses.
 */
export function buildDigest(pipeline: PipelineRow[], today: string, origin: string, now = new Date()): string {
  const real = pipeline.filter((r) => !r.is_demo);
  const active = real.filter((r) => r.state === "active");
  const unknown = real.filter((r) => r.state === "failed" || r.state === "quiet_partial" || r.state === "not_checked").length;
  const due = real.filter((r) => cadence(r.relationship_status, r.last_contact_date, today)?.due).length;
  const hold = active.filter(HOLD).length;
  const picks = topPicks(real);

  const lines = [`${greeting(now)}, Vikram. Your VC pipeline today:`, "", `${active.length} of ${real.length} investors have a fresh, relevant signal.`];
  if (picks.length) {
    lines.push("", "Email first:");
    picks.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.row.firm_name} (score ${p.row.follow_up_score ?? "-"})`);
      if (p.row.lead?.headline) lines.push(`   ${clip(p.row.lead.headline, 110)}`);
      lines.push(`   ${origin}/investors/${p.row.id}`);
    });
  } else lines.push("", "Nobody is worth an email today.");
  lines.push("", `Follow-ups due: ${due}`, `Waiting or passed (don't chase): ${hold}`, `Couldn't check yet: ${unknown}`, "", `Full brief: ${origin}/brief`);
  return lines.join("\n");
}

/** Sends one plain-text message through the Telegram Bot API. Never logs or returns the token. */
export async function sendTelegram(text: string, token: string, chatId: string): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status };
}
