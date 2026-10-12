import type { Db } from "@/lib/db";
import { cadence } from "@/lib/cadence";
import { ACTION_LABEL, ENTITY_LABEL, REL_LABEL, fmtDate, hostOf } from "@/lib/format";
import { topPicks } from "@/lib/picks";
import { getOverview, listSignals, type PipelineRow, type Scope } from "@/lib/read";

/**
 * What the assistant is allowed to know: the same facts the dashboard shows (scores, actions, the lead evidence, the relationship
 * STATUS and last-contact date), and nothing the founder keeps private. Personal notes, contact history and contact emails are
 * never read here, so no question can make the assistant repeat them. Everything that came from the web (headlines, excerpts) is
 * cleaned and fenced as data, because a web page can contain instructions aimed at a model.
 */
export interface ChatContext {
  text: string;
  rows: PipelineRow[];
  picks: PipelineRow[];
  mentioned: PipelineRow[];
  counts: { total: number; active: number; quiet: number; review: number; failed: number };
}

/** Words that appear in many investor names (or in the demo accounts' names) and so say nothing about WHICH investor is meant. */
const GENERIC = new Set([
  "capital", "ventures", "venture", "partners", "partner", "india", "fund", "funds", "angel", "angels", "network", "labs", "advisors", "investments",
  "holdings", "management", "group", "high", "priority", "low", "demo", "stale", "signal", "unverified", "irrelevant", "duplicate",
]);
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Untrusted text from the web: single line, no markup, bounded. */
export const clean = (s: string | null | undefined, max = 300) =>
  (s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** The investors a question is about: the full name, or a distinctive word of it, appears in the text. First three, in order of appearance. */
export function mentioned(text: string, rows: PipelineRow[]): PipelineRow[] {
  const t = text.toLowerCase();
  const hits: { r: PipelineRow; at: number }[] = [];
  for (const r of rows) {
    const full = r.firm_name.toLowerCase();
    let at = t.indexOf(full);
    if (at < 0) {
      for (const w of full.split(/[^a-z0-9]+/).filter((x) => x.length >= 4 && !GENERIC.has(x))) {
        const m = new RegExp(`\\b${esc(w)}\\b`).exec(t);
        if (m && (at < 0 || m.index < at)) at = m.index;
      }
    }
    if (at >= 0) hits.push({ r, at });
  }
  return hits.sort((a, b) => a.at - b.at).slice(0, 3).map((h) => h.r);
}

const line = (r: PipelineRow) => {
  const lead = r.lead ? ` | lead: ${clean(r.lead.headline, 110)} (${fmtDate(r.lead.published_at)}, ${hostOf(r.lead.url)})` : "";
  return `- ${clean(r.firm_name, 60)} | ${ENTITY_LABEL[r.entity_type] ?? r.entity_type} | score ${r.follow_up_score ?? "none"} | ${r.recommended_action ? ACTION_LABEL[r.recommended_action] : "not scored"} | ${r.state} | relationship: ${REL_LABEL[r.relationship_status] ?? r.relationship_status}${lead}`;
};

export async function buildContext(db: Db, today: string, scope: Scope, question: string): Promise<ChatContext> {
  const ov = await getOverview(db, today, scope);
  const rows = scope === true ? ov.pipeline : ov.pipeline.filter((r) => !r.is_demo);
  const picks = topPicks(rows).map((p) => p.row);
  const about = mentioned(question, rows);
  const parts: string[] = [
    `TODAY: ${today}. The founder is Vikram, a first-time founder raising a Seed round for a B2B logistics SaaS.`,
    `SUMMARY: ${ov.counts.total} tracked investors. ${ov.counts.active} have a verified, relevant signal in the last 30 days; ${ov.counts.quiet} were searched and found nothing relevant; ${ov.counts.review + ov.counts.failed} could not be fully checked (activity unknown, which is NOT the same as quiet). Last completed refresh: ${ov.lastGood ? fmtDate(ov.lastGood.completed_at) : "none yet"}.`,
    `HOW SCORES WORK: score 0-100 from fixed rules (recency, relevance to logistics, evidence quality, investor fit, relationship). 75 or more with a clean lead signal = "Reach out now"; 55 or more = "Prepare targeted outreach". Investors already contacted or awaiting a reply are not chased.`,
    `START HERE (the investors worth an email this week):\n${picks.length ? picks.map((r, i) => `${i + 1}. ${line(r).slice(2)}${r.lead?.why ? ` | why: ${clean(r.lead.why, 200)}` : ""}`).join("\n") : "none right now"}`,
    `ALL INVESTORS (name | type | score | action | state | relationship | lead signal):\n${rows.map(line).join("\n")}`,
  ];
  const due = rows.flatMap((r) => { const c = cadence(r.relationship_status, r.last_contact_date, today); return c?.due ? [`- ${clean(r.firm_name, 60)}: ${c.label}`] : []; });
  parts.push(`FOLLOW-UPS DUE:\n${due.length ? due.join("\n") : "none"}`);

  for (const r of about) {
    const sigs = (await listSignals(db, today, { show: "verified", investor: r.id }, scope)).slice(0, 5);
    parts.push(
      `DETAIL: ${clean(r.firm_name, 60)}\n` +
        `score ${r.follow_up_score ?? "none"}; ${r.explanation ? clean(r.explanation, 500) : "no explanation stored"}\n` +
        (r.capped_by.length ? `held back from "reach out now" because: ${r.capped_by.map((c) => clean(c, 160)).join("; ")}\n` : "") +
        `sectors: ${r.sectors.map((s) => clean(s, 40)).join(", ") || "unknown"}; stage: ${clean(r.stage_preference, 60) || "unknown"}; last checked: ${r.last_checked ? fmtDate(r.last_checked) : "never"}${r.last_error ? ` (last error: ${clean(r.last_error, 120)})` : ""}\n` +
        (sigs.length
          ? `signals in the last 30 days:\n${sigs.map((s) => `  * ${clean(s.headline, 140)} (${fmtDate(s.published_at)}, ${clean(s.source_name, 40)}, relevance ${s.relevance_score ?? "?"}) summary: ${clean(s.summary, 220)} | quote: "${clean(s.evidence_excerpt, 260)}"`).join("\n")}`
          : "signals in the last 30 days: none verified"),
    );
  }
  return { text: parts.join("\n\n"), rows, picks, mentioned: about, counts: ov.counts };
}
