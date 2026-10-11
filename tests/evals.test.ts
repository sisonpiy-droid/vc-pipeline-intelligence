import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mentionsInvestor } from "@/lib/signals/match";

/**
 * Offline checks on the golden AI cases (no model call): the cases are well-formed, each candidate really names
 * its investor, and the set covers each class of failure we have actually seen. The live model is exercised by
 * `npm run eval:live`, which asserts the expectations below against Gemini.
 */
export const CaseSchema = z.object({
  id: z.string(),
  why: z.string().min(20),
  investor: z.object({ firm_name: z.string(), aliases: z.array(z.string()), entity_type: z.enum(["vc_firm", "angel", "network", "accelerator"]) }),
  candidate: z.object({ title: z.string(), url: z.string().url(), published_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), text: z.string().min(150), official: z.boolean().optional() }),
  expect: z.object({ verified: z.boolean().optional(), new_capital: z.boolean().optional(), relevance: z.object({ min: z.number().optional(), max: z.number().optional() }).optional() }),
});

const cases = z.array(CaseSchema).parse(JSON.parse(readFileSync("tests/evals/cases.json", "utf8")));

describe("golden AI cases", () => {
  it("ids are unique and every case states why it exists", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });
  it.each(cases.map((c) => [c.id, c] as const))("%s: the candidate names its investor (or is official) and has a usable expectation", (_id, c) => {
    expect(c.candidate.official || mentionsInvestor(`${c.candidate.title}\n${c.candidate.text}`, { firm_name: c.investor.firm_name, aliases: c.investor.aliases })).toBe(true);
    expect(Object.keys(c.expect).length).toBeGreaterThan(0);
  });
  it("covers the failure classes seen in production and the good signals", () => {
    const ids = cases.map((c) => c.id);
    for (const need of ["ipo-shareholder-list", "directory-listicle", "profile-page", "passing-mention", "prompt-injection", "seed-cap-raised", "new-fund-close", "official-post-we", "off-thesis-consumer-fund"]) expect(ids).toContain(need);
    expect(cases.filter((c) => c.expect.verified === false).length).toBeGreaterThanOrEqual(5);
    expect(cases.filter((c) => c.expect.verified === true).length).toBeGreaterThanOrEqual(3);
  });
});
