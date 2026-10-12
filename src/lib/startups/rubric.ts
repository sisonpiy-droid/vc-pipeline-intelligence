import { z } from "zod";
import { DEFAULT_CONFIG, type FitConfig, type ScoringConfig, type SectorMatch } from "@/lib/scoring/score";

/**
 * A startup and its scoring rubric. The rubric is data for the SAME deterministic scoring function the main dashboard uses
 * (lib/scoring/score.ts): Gemini may propose it, but every number is clamped here before it can reach the arithmetic, and the
 * founder can edit it. Nothing a model returns is used as-is.
 */
export const STAGES = ["pre_seed", "seed", "series_a", "series_b_plus"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { pre_seed: "Pre-seed", seed: "Seed", series_a: "Series A", series_b_plus: "Series B or later" };

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const ProfileSchema = z.object({
  name: text(2, 80),
  pitch: text(10, 400),
  sector: text(3, 120),
  stage: z.enum(STAGES),
  geography: text(2, 80).default("Global"),
  round_size: optional(60),
  ask: optional(300),
});
export type StartupProfile = z.infer<typeof ProfileSchema>;

export const SECTOR_KEYS = ["logistics", "b2b_software", "seed_generalist", "adjacent", "unrelated"] as const satisfies readonly SectorMatch[];
/** In this rubric the storage key "logistics" means "the startup's own (core) market", whatever that market is. */
export const SECTOR_LABEL: Record<SectorMatch, string> = {
  logistics: "Core market",
  b2b_software: "B2B software, other market",
  seed_generalist: "General early-stage activity",
  adjacent: "A different vertical",
  unrelated: "Unrelated",
};

const terms = z.array(z.string()).max(24);

export interface Rubric {
  market: { sector: string; core: string };
  /** What each topic class means for this startup. Shown to Gemini when it judges evidence, and to the founder. */
  definitions: Record<SectorMatch, string>;
  weights: Record<"recency" | "relevance" | "evidence" | "fit" | "relationship", number>;
  thresholds: { reachOutNow: number; prepareOutreach: number };
  reachOutMinRelevance: number;
  sectorCap: Record<SectorMatch, number>;
  fit: FitConfig;
  /** Why each part is what it is, in the model's or the default builder's words. */
  rationale: Record<"weights" | "thresholds" | "sector" | "fit", string>;
}

/** What Gemini is asked to return (and what the editor submits): loosely typed here, repaired by `sanitizeRubric`. */
export const RubricInputSchema = z.object({
  market: z.object({ sector: z.string(), core: z.string() }),
  definitions: z.object({ logistics: z.string(), b2b_software: z.string(), seed_generalist: z.string(), adjacent: z.string(), unrelated: z.string() }),
  weights: z.object({ recency: z.number(), relevance: z.number(), evidence: z.number(), fit: z.number(), relationship: z.number() }),
  thresholds: z.object({ reachOutNow: z.number(), prepareOutreach: z.number() }),
  reachOutMinRelevance: z.number(),
  sectorCap: z.object({ logistics: z.number(), b2b_software: z.number(), seed_generalist: z.number(), adjacent: z.number(), unrelated: z.number() }),
  fit: z.object({ coreTerms: terms, adjacentTerms: terms, stageBest: terms, stageOk: terms, stagePoor: terms, geographyTerms: terms }),
  rationale: z.object({ weights: z.string(), thresholds: z.string(), sector: z.string(), fit: z.string() }),
});

const STOP = new Set("the and for with that this from into their our your are was were has have will can all any not but its it's more most than then them they startup startups company companies platform solution solutions based using use used build builds building helps help make makes provide provides".split(" "));

/** Distinctive words of a free-text sector ("B2B payments infrastructure" → payments, infrastructure). */
export function keywordsOf(sector: string): string[] {
  const words = sector.toLowerCase().split(/[^a-z0-9+&-]+/).filter((w) => w.length >= 4 && !STOP.has(w) && !/^b2[bc]$/.test(w));
  return [...new Set(words)].slice(0, 8);
}

const STAGE_TERMS: Record<Stage, Pick<FitConfig, "stageBest" | "stageOk" | "stagePoor">> = {
  pre_seed: { stageBest: ["pre-seed", "pre seed", "angel", "very early", "accelerator"], stageOk: ["seed", "early"], stagePoor: ["series a", "growth", "scale"] },
  seed: { stageBest: ["seed", "angel", "accelerator", "very early", "pre-seed"], stageOk: ["early"], stagePoor: ["series a", "growth", "scale"] },
  series_a: { stageBest: ["series a", "early growth"], stageOk: ["seed", "early", "growth", "series b"], stagePoor: ["angel", "pre-seed", "accelerator"] },
  series_b_plus: { stageBest: ["series b", "series c", "growth", "late stage", "scale"], stageOk: ["series a", "early growth"], stagePoor: ["seed", "angel", "pre-seed", "accelerator"] },
};

const GLOBAL_RE = /global|worldwide|anywhere|international|remote/i;
export const geographyTermsOf = (geography: string): string[] =>
  GLOBAL_RE.test(geography) ? [] : [...new Set(geography.toLowerCase().split(/[,/&]|\band\b/).map((g) => g.trim()).filter((g) => g.length >= 2))].slice(0, 6);

/** A sensible rubric built from the profile alone, with no model. Used when Gemini is unavailable and to repair its output. */
export function defaultRubric(p: StartupProfile): Rubric {
  const core = keywordsOf(p.sector);
  const b2b = /\bb2b\b|saas|enterprise|software/i.test(`${p.sector} ${p.pitch}`);
  const stage = STAGE_LABEL[p.stage].toLowerCase();
  return {
    market: { sector: p.sector, core: p.sector },
    definitions: {
      logistics: `Directly about ${p.sector}: investments, funds, theses or statements in this market.`,
      b2b_software: "Enterprise or B2B software and infrastructure in a different market.",
      seed_generalist: `The investor's general ${stage} activity across sectors: a new fund, programme, cheque size, thesis or advice to founders.`,
      adjacent: "A deal in a different vertical (for example consumer, health, hardware, education) that does not touch this market.",
      unrelated: "Not about investing or startups at all.",
    },
    weights: { ...DEFAULT_CONFIG.weights },
    thresholds: { ...DEFAULT_CONFIG.thresholds },
    reachOutMinRelevance: DEFAULT_CONFIG.reachOutMinRelevance,
    sectorCap: { ...DEFAULT_CONFIG.sectorCap },
    fit: { coreTerms: core, adjacentTerms: b2b ? ["b2b", "saas", "enterprise", "software"] : [], ...STAGE_TERMS[p.stage], geographyTerms: geographyTermsOf(p.geography) },
    rationale: {
      weights: "The standard weighting: how recent the signal is (30), how relevant it is to this market (30), how well evidenced it is (20), how well the investor's profile fits (15) and the relationship (5).",
      thresholds: "The standard thresholds: 75 or more to reach out now, 55 or more to prepare targeted outreach.",
      sector: `Evidence about ${p.sector} counts in full; general early-stage or B2B activity is capped at 62, other verticals at 45 and unrelated news at 20, so an off-topic deal cannot rank highly.`,
      fit: `Investors whose sectors or thesis mention ${core.length ? core.join(", ") : "this market"} fit best; stage preference is matched against ${stage}; geography against ${p.geography}.`,
    },
  };
}

const clamp = (n: number, lo: number, hi: number, fallback: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);
const str = (v: unknown, max: number, fallback: string) => { const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : ""; return s || fallback; };
const termList = (v: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(v)) return fallback;
  const out = [...new Set(v.map((t) => (typeof t === "string" ? t.toLowerCase().replace(/\s+/g, " ").trim() : "")).filter((t) => t.length >= 2 && t.length <= 40))].slice(0, 24);
  return out.length || v.length === 0 ? out : fallback;
};

/**
 * Turns anything (a model's reply, an edited form) into a rubric the scoring function can safely run: every number clamped,
 * weights rescaled to total exactly 100, thresholds ordered, topic caps non-increasing, term lists cleaned. Missing or invalid
 * parts fall back to `base`.
 */
export function sanitizeRubric(raw: unknown, base: Rubric): Rubric {
  const parsed = RubricInputSchema.safeParse(raw);
  const r = parsed.success ? parsed.data : (typeof raw === "object" && raw ? (raw as Record<string, never>) : ({} as Record<string, never>));
  const get = <T,>(path: string[], fallback: T): T => path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), r) as T ?? fallback;

  // weights: each 0..60, then rescaled to sum to exactly 100 (largest-remainder rounding)
  const keys = ["recency", "relevance", "evidence", "fit", "relationship"] as const;
  const wRaw = keys.map((k) => clamp(Number(get(["weights", k], base.weights[k])), 0, 60, base.weights[k]));
  const wSum = wRaw.reduce((a, b) => a + b, 0) || 100;
  const scaled = wRaw.map((w) => (w / wSum) * 100);
  const floor = scaled.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  scaled.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left-- > 0) floor[i]!++; });
  const weights = Object.fromEntries(keys.map((k, i) => [k, floor[i]!])) as Rubric["weights"];

  const reach = Math.round(clamp(Number(get(["thresholds", "reachOutNow"], base.thresholds.reachOutNow)), 60, 90, base.thresholds.reachOutNow));
  const prep = Math.round(clamp(Number(get(["thresholds", "prepareOutreach"], base.thresholds.prepareOutreach)), 35, reach - 5, Math.min(base.thresholds.prepareOutreach, reach - 5)));

  const cap = (k: SectorMatch, lo: number, hi: number) => Math.round(clamp(Number(get(["sectorCap", k], base.sectorCap[k])), lo, hi, base.sectorCap[k]));
  const b2bCap = cap("b2b_software", 40, 80), seedCap = cap("seed_generalist", 40, 80);
  const adjCap = Math.min(cap("adjacent", 20, 60), b2bCap, seedCap);
  const unrelCap = Math.min(cap("unrelated", 0, 30), adjCap);

  const f = (k: keyof FitConfig) => termList(get(["fit", k], undefined as unknown), base.fit[k]);
  const defs = Object.fromEntries(SECTOR_KEYS.map((k) => [k, str(get(["definitions", k], undefined as unknown), 300, base.definitions[k])])) as Rubric["definitions"];

  return {
    market: { sector: str(get(["market", "sector"], undefined as unknown), 120, base.market.sector), core: str(get(["market", "core"], undefined as unknown), 80, base.market.core) },
    definitions: defs,
    weights,
    thresholds: { reachOutNow: reach, prepareOutreach: prep },
    reachOutMinRelevance: Math.round(clamp(Number(get(["reachOutMinRelevance"], base.reachOutMinRelevance)), 50, 80, base.reachOutMinRelevance)),
    sectorCap: { logistics: 100, b2b_software: b2bCap, seed_generalist: seedCap, adjacent: adjCap, unrelated: unrelCap },
    fit: { coreTerms: f("coreTerms").length ? f("coreTerms") : base.fit.coreTerms, adjacentTerms: f("adjacentTerms"), stageBest: f("stageBest").length ? f("stageBest") : base.fit.stageBest, stageOk: f("stageOk"), stagePoor: f("stagePoor"), geographyTerms: f("geographyTerms") },
    rationale: Object.fromEntries((["weights", "thresholds", "sector", "fit"] as const).map((k) => [k, str(get(["rationale", k], undefined as unknown), 500, base.rationale[k])])) as Rubric["rationale"],
  };
}

/** The scoring function's own config for a rubric. */
export function rubricToConfig(r: Rubric): ScoringConfig {
  return {
    ...DEFAULT_CONFIG,
    weights: { ...r.weights },
    thresholds: { ...r.thresholds },
    reachOutMinRelevance: r.reachOutMinRelevance,
    sectorCap: { ...r.sectorCap },
    market: { ...r.market },
    fit: { ...r.fit },
  };
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "startup";
}
