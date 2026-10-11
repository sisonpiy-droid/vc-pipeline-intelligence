import { z } from "zod";

export const SIGNAL_TYPES = [
  "portfolio_investment",
  "article",
  "interview_podcast",
  "public_statement",
  "event_appearance",
  "fund_thesis_announcement",
  "other",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

/** What the model may say about ONE candidate. Dates, URLs and scores' arithmetic are never the model's job. */
export const AssessmentSchema = z.object({
  index: z.number().int().min(0),
  investor_involvement: z.enum(["verified", "unclear", "not_involved"]),
  /** True only if the page reports a specific event (investment, statement, appearance, announcement) that the investor took part in and that happened in the recent window. False for profiles, directories, listicles, evergreen descriptions. */
  specific_recent_event: z.boolean(),
  /** True only if the investor announced a new fund, a fund close, or a bigger cheque ceiling / new programme: capital is available to deploy. */
  new_capital: z.boolean(),
  signal_type: z.enum(SIGNAL_TYPES),
  relevance: z.number().int().min(0).max(100),
  confidence: z.enum(["high", "medium", "low"]),
  evidence_excerpt: z.string().min(10).max(600),
  summary: z.string().min(10).max(300),
  why_it_matters: z.string().min(10).max(450),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

export const BatchSchema = z.object({ assessments: z.array(AssessmentSchema).max(20) });

/** Gemini `responseSchema` (OpenAPI subset). Kept next to the zod schema; the zod schema is the authority. */
export const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    assessments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER" },
          investor_involvement: { type: "STRING", enum: ["verified", "unclear", "not_involved"] },
          specific_recent_event: { type: "BOOLEAN" },
          new_capital: { type: "BOOLEAN" },
          signal_type: { type: "STRING", enum: [...SIGNAL_TYPES] },
          relevance: { type: "INTEGER" },
          confidence: { type: "STRING", enum: ["high", "medium", "low"] },
          evidence_excerpt: { type: "STRING" },
          summary: { type: "STRING" },
          why_it_matters: { type: "STRING" },
        },
        required: [
          "index", "investor_involvement", "specific_recent_event", "new_capital", "signal_type", "relevance", "confidence",
          "evidence_excerpt", "summary", "why_it_matters",
        ],
      },
    },
  },
  required: ["assessments"],
} as const;
