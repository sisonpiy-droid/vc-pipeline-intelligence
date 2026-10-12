import type { Step, StepRow } from "./store";

/** The exact workflow, as shown on a startup's page: who does each step, what it does, and what it costs. Static text; the live status comes from the database. */
export interface StepInfo {
  key: Step | "shortlist";
  title: string;
  by: "You" | "Gemini Flash" | "Code" | "Code + database";
  what: string;
  cost: string;
}

export const WORKFLOW: StepInfo[] = [
  { key: "profile", title: "Describe the startup", by: "You", what: "Name, what it does, sector, stage, geography, round size and what you want from investors. Checked and saved.", cost: "Free" },
  { key: "rubric", title: "Write the scoring rubric", by: "Gemini Flash", what: "Gemini reads the profile and proposes the weights, the thresholds, what each topic class means for this startup (and the highest relevance each may have) and the keywords that decide investor fit. Code then clamps every number: weights rescale to 100, thresholds are ordered, caps cannot rise. If Gemini fails, a plain default built from the profile is used and labelled. You can edit it.", cost: "1 Gemini call" },
  { key: "candidates", title: "Choose who can be scored", by: "Code + database", what: "The shared list of investors. Only investors that have had a completed evidence search are scored; the rest are left out and counted, never shown as quiet. Demo accounts are excluded.", cost: "Free" },
  { key: "evidence", title: "Gather the evidence", by: "Code + database", what: "The verified signals from the last 30 days already collected for those investors: what each investor itself did, with its source link and date. No new search runs, and nothing from your other startups or your private notes is read.", cost: "No search credits" },
  { key: "judge", title: "Judge each signal for this startup", by: "Gemini Flash", what: "For each investor, Gemini reads their signals and says how relevant each is to this startup and which topic class it falls in. Answers are validated; an omitted or invalid answer leaves the signal out, and the investor is marked not conclusive. Judgements are saved, so re-scoring is free.", cost: "About 1 Gemini call per investor with evidence" },
  { key: "score", title: "Score every investor", by: "Code", what: "A fixed formula, no model: recency, relevance (capped by topic class), evidence strength, investor fit and relationship, using this rubric's weights. Gates stop “reach out now” when the lead signal is weak, off-topic, low-confidence or social-only.", cost: "Free" },
  { key: "shortlist", title: "Read the shortlist", by: "You", what: "Investors grouped by recommended action, each with its lead evidence, its score breakdown and why. Nothing is sent from this app: you decide who to contact.", cost: "Free" },
];

export type DisplayStatus = StepRow["status"];

/** The shortlist step has no row of its own: it is done when scores exist. */
export function statusOf(key: StepInfo["key"], steps: StepRow[], hasScores: boolean): { status: DisplayStatus; detail: string | null } {
  if (key === "shortlist") return hasScores ? { status: "done", detail: null } : { status: "pending", detail: "Appears once the evaluation has run." };
  const s = steps.find((x) => x.step === key);
  return { status: s?.status ?? "pending", detail: s?.detail ?? null };
}
