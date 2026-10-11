/**
 * Runs the golden cases (tests/evals/cases.json) against the REAL Gemini model and checks each expectation.
 * One model call per case (free tier). Use it after changing the prompt or the model:   npm run eval:live
 * A case passes when the full verification (model output + the code-side checks) gives the expected verdict.
 */
import { readFileSync } from "node:fs";
import { analyzeCandidates } from "../src/lib/ai/analyze";
import { createGemini } from "../src/lib/ai/gemini";

interface Case {
  id: string;
  investor: { firm_name: string; aliases: string[]; entity_type: string };
  candidate: { title: string; url: string; published_at: string; text: string; official?: boolean };
  expect: { verified?: boolean; new_capital?: boolean; relevance?: { min?: number; max?: number } };
}
const cases = JSON.parse(readFileSync("tests/evals/cases.json", "utf8")) as Case[];
const ai = createGemini();
let failed = 0;

for (const c of cases) {
  const r = await analyzeCandidates(ai, { ...c.investor, role_title: null, partner_name: null }, [{ index: 0, ...c.candidate }]);
  const v = r.verdicts[0]!;
  const a = "assessment" in v ? v.assessment : undefined;
  const problems: string[] = [];
  if (r.ai_error) problems.push(`AI error ${r.ai_error.category}`);
  if (c.expect.verified !== undefined && (v.status === "verified") !== c.expect.verified) problems.push(`expected verified=${c.expect.verified}, got ${v.status}${"reason" in v ? ` (${v.reason})` : ""}`);
  if (c.expect.new_capital !== undefined && a && a.new_capital !== c.expect.new_capital) problems.push(`expected new_capital=${c.expect.new_capital}, got ${a.new_capital}`);
  if (c.expect.relevance) {
    const rel = a?.relevance;
    if (rel === undefined) problems.push("no relevance returned");
    else {
      if (c.expect.relevance.min !== undefined && rel < c.expect.relevance.min) problems.push(`relevance ${rel} < min ${c.expect.relevance.min}`);
      if (c.expect.relevance.max !== undefined && rel > c.expect.relevance.max) problems.push(`relevance ${rel} > max ${c.expect.relevance.max}`);
    }
  }
  const got = `${v.status}${"reason" in v ? `:${v.reason}` : ""}${a ? ` rel=${a.relevance} cap=${a.new_capital}` : ""}`;
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${c.id.padEnd(30)} ${got}${problems.length ? `\n        → ${problems.join("; ")}` : ""}`);
  if (problems.length) failed++;
}
console.log(failed ? `\n${failed} of ${cases.length} case(s) failed.` : `\nAll ${cases.length} golden cases passed against the live model.`);
process.exit(failed ? 1 : 0);
