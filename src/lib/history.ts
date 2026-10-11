/**
 * Score history: every time an investor is scored (a refresh or a search-free re-score) one row is stored with the
 * full breakdown. This turns a snapshot into a story: how the score moved, and which factor moved it.
 */
export type Breakdown = Record<string, { points: number; max: number; note: string }>;

export interface HistoryPoint {
  at: string;
  source: "refresh" | "rescore";
  score: number;
  action: string;
  breakdown: Breakdown | null;
}

export interface Move {
  at: string;
  from: number;
  to: number;
  delta: number;
  action_from: string;
  action_to: string;
  /** Components that moved by at least a point, biggest first. */
  drivers: { factor: string; delta: number }[];
  /** One plain sentence a founder can read. */
  reason: string;
}

const WHY: Record<string, [string, string]> = {
  recency: ["the lead signal is getting older", "a fresher signal arrived"],
  relevance: ["the evidence is judged less relevant", "the evidence is judged more relevant"],
  evidence: ["the evidence is weaker or less corroborated", "the evidence is stronger or corroborated"],
  fit: ["the investor's profile fit changed", "the investor's profile fit improved"],
  relationship: ["your relationship status changed", "your relationship status changed"],
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Moves between consecutive scorings, oldest first. A move is a change of at least `minDelta` points or of the
 * recommended action; identical consecutive rows (a re-score that changed nothing) are not moves.
 */
export function explainMoves(chronological: HistoryPoint[], minDelta = 3): Move[] {
  const out: Move[] = [];
  for (let i = 1; i < chronological.length; i++) {
    const a = chronological[i - 1]!;
    const b = chronological[i]!;
    const delta = b.score - a.score;
    if (Math.abs(delta) < minDelta && a.action === b.action) continue;
    const drivers = Object.keys(b.breakdown ?? {})
      .map((factor) => ({ factor, delta: r1((b.breakdown?.[factor]?.points ?? 0) - (a.breakdown?.[factor]?.points ?? 0)) }))
      .filter((d) => Math.abs(d.delta) >= 1)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    const top = drivers[0];
    const why = top ? WHY[top.factor]?.[top.delta < 0 ? 0 : 1] : null;
    const actionPart = a.action !== b.action ? `; the recommendation moved from “${a.action.replace(/_/g, " ")}” to “${b.action.replace(/_/g, " ")}”` : "";
    out.push({
      at: b.at, from: a.score, to: b.score, delta, action_from: a.action, action_to: b.action, drivers,
      reason: `${delta >= 0 ? "Up" : "Down"} ${Math.abs(delta)} point${Math.abs(delta) === 1 ? "" : "s"}${why ? `: ${why}` : ""}${actionPart}.`,
    });
  }
  return out;
}

/** Drop re-scores that changed nothing, so a flat line is not drawn as dozens of identical points. */
export function distinctPoints(chronological: HistoryPoint[]): HistoryPoint[] {
  return chronological.filter((p, i) => i === 0 || i === chronological.length - 1 || p.score !== chronological[i - 1]!.score || p.action !== chronological[i - 1]!.action);
}
