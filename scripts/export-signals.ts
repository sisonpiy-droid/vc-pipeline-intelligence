/**
 * Read-only export of every verified signal with the evidence behind it, plus each investor's current action.
 * Used to hand-label a sample for the accuracy table (tests/evals/labels.json) and to snapshot "before" numbers.
 *   npm run export:signals -- out.json
 */
import { writeFileSync } from "node:fs";
import { getDb } from "../src/lib/db";

const out = process.argv[2];
if (!out) throw new Error("usage: npm run export:signals -- <out.json>");
const db = getDb();
const signals = (await db.query(
  `select s.id, i.firm_name, i.entity_type, s.headline, s.source_name, s.url, s.published_at::text as published_at, s.signal_type,
          s.relevance_score, s.evidence_confidence, s.summary, s.evidence_excerpt, s.relevance_explanation
     from signals s join investors i on i.id = s.investor_id
    where s.verification_status = 'verified' and s.duplicate_of is null
    order by i.firm_name, s.published_at desc`,
)).rows;
const investors = (await db.query(
  `select id, firm_name, entity_type, follow_up_score, recommended_action, last_signal_date::text as last_signal_date from investors order by follow_up_score desc nulls last`,
)).rows;
writeFileSync(out, JSON.stringify({ exported_at: new Date().toISOString(), investors, signals }, null, 1));
console.log(`${signals.length} signals, ${investors.length} investors -> ${out}`);
await db.close();
