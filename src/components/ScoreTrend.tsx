import { ACTION_THRESHOLDS } from "@/lib/scoring/score";
import { ACTION_LABEL, fmtDate } from "@/lib/format";
import { distinctPoints, explainMoves, type HistoryPoint } from "@/lib/history";
import { Eyebrow } from "./ui";

/**
 * The score over time, drawn from stored scorings (never interpolated): dashed lines mark the two action thresholds, each
 * dot is a real scoring with its date, score and action in the tooltip. Below it, the moves in plain words.
 */
export function ScoreTrend({ chronological }: { chronological: HistoryPoint[] }) {
  const pts = distinctPoints(chronological);
  if (pts.length === 0) return null;
  const W = 320, H = 96, PX = 8, PY = 10;
  const t0 = new Date(pts[0]!.at).getTime();
  const span = Math.max(1, new Date(pts.at(-1)!.at).getTime() - t0);
  const x = (p: HistoryPoint) => (pts.length === 1 ? W / 2 : PX + ((new Date(p.at).getTime() - t0) / span) * (W - PX * 2));
  const y = (score: number) => PY + (1 - score / 100) * (H - PY * 2);
  const line = pts.map((p) => `${x(p).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const moves = explainMoves(chronological).slice(-4).reverse();
  const last = pts.at(-1)!;
  return (
    <div>
      <Eyebrow>Score over time</Eyebrow>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score history: ${pts.map((p) => `${fmtDate(p.at)} ${p.score}`).join(", ")}`} className="mt-3 w-full overflow-visible">
        {([ACTION_THRESHOLDS.reachOutNow, ACTION_THRESHOLDS.prepareOutreach] as number[]).map((t) => (
          <g key={t}>
            <line x1={PX} x2={W - PX} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity="0.18" strokeDasharray="3 4" />
            <text x={W - PX} y={y(t) - 3} textAnchor="end" className="fill-muted" fontSize="8">{t}</text>
          </g>
        ))}
        {pts.length > 1 && <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />}
        {pts.map((p, i) => (
          <circle key={`${p.at}-${i}`} cx={x(p)} cy={y(p.score)} r={p === last ? 4 : 2.6} fill={p === last ? "var(--accent)" : "var(--surface)"} stroke="var(--accent)" strokeWidth="1.4">
            <title>{`${fmtDate(p.at)} · ${p.score} · ${ACTION_LABEL[p.action] ?? p.action}${p.source === "rescore" ? " (re-scored from stored evidence)" : ""}`}</title>
          </circle>
        ))}
      </svg>
      <div className="num mt-1 flex justify-between text-[0.65rem] text-muted"><span>{fmtDate(pts[0]!.at)}</span><span>{pts.length > 1 ? fmtDate(last.at) : "first scoring"}</span></div>
      {moves.length > 0 ? (
        <ul className="mt-4 space-y-2.5 border-t border-line pt-3 text-xs leading-relaxed">
          {moves.map((m) => (
            <li key={m.at}>
              <span className="num text-muted">{fmtDate(m.at)} </span>
              <span className={`num font-medium ${m.delta >= 0 ? "text-good" : "text-warn"}`}>{m.delta >= 0 ? "▲" : "▼"} {Math.abs(m.delta)}</span>{" "}
              <span className="text-muted">{m.reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-muted">{pts.length > 1 ? "The score has been steady." : "One scoring so far, so no movement to explain yet."}</p>
      )}
    </div>
  );
}
