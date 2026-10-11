"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { ACTION_LABEL, ACTION_TONE, ENTITY_LABEL } from "@/lib/format";
import { scoreInvestor } from "@/lib/scoring/score";
import { buildConfig, DEFAULT_CONTROLS, PRESETS, type Controls, type SimInvestor } from "@/lib/simulate";
import { gsap, prefersReducedMotion } from "./motion/gsap";
import { Flip } from "gsap/Flip";
import { Bar, Pill } from "./ui";

if (typeof window !== "undefined") gsap.registerPlugin(Flip);

const SHOWN = 24;
const WEIGHT_KEYS = ["recency", "relevance", "evidence", "fit", "relationship"] as const;

function Slider({ label, value, min, max, step = 1, suffix = "", hint, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; hint?: string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-xs font-medium">
        <span>{label}</span>
        <span className="num text-muted">{Math.round(value * 10) / 10}{suffix}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" aria-label={label} />
      {hint && <span className="mt-0.5 block text-[0.7rem] leading-snug text-muted">{hint}</span>}
    </label>
  );
}

/**
 * Re-ranks every checked investor with the founder's own scoring preferences, live in the browser. It runs the same
 * scoring function the server uses, on stored evidence; nothing is saved and nothing is sent anywhere.
 */
export function Simulator({ investors, now }: { investors: SimInvestor[]; now: string }) {
  const [c, setC] = useState<Controls>(DEFAULT_CONTROLS);
  const [preset, setPreset] = useState("default");
  const list = useRef<HTMLOListElement>(null);
  const pending = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const when = useMemo(() => new Date(`${now}T12:00:00Z`), [now]);

  const baseline = useMemo(() => {
    const cfg = buildConfig(DEFAULT_CONTROLS);
    return new Map(investors.map((i) => [i.id, scoreInvestor({ ...i.input, now: when, config: cfg })]));
  }, [investors, when]);

  const rows = useMemo(() => {
    const cfg = buildConfig(c);
    const scored = investors.map((i) => ({ i, r: scoreInvestor({ ...i.input, now: when, config: cfg }), base: baseline.get(i.id)! }));
    scored.sort((a, b) => b.r.score - a.r.score || a.i.firm_name.localeCompare(b.i.firm_name));
    const baseRank = new Map([...scored].sort((a, b) => b.base.score - a.base.score || a.i.firm_name.localeCompare(b.i.firm_name)).map((s, n) => [s.i.id, n + 1]));
    return scored.map((s, n) => ({ ...s, rank: n + 1, baseRank: baseRank.get(s.i.id)! }));
  }, [c, investors, when, baseline]);

  const cfg = useMemo(() => buildConfig(c), [c]);
  const reach = rows.filter((r) => r.r.action === "reach_out_now").length;
  const baseReach = [...baseline.values()].filter((r) => r.action === "reach_out_now").length;
  const changedAction = rows.filter((r) => r.r.action !== r.base.action).length;
  const moved = rows.filter((r) => r.rank !== r.baseRank).length;

  // Capture positions BEFORE React re-renders, animate from them AFTER (GSAP Flip). Skipped for reduced motion.
  function update(next: Controls, key = "custom") {
    if (list.current && !prefersReducedMotion()) pending.current = Flip.getState(list.current.querySelectorAll("[data-flip]"));
    setC(next);
    setPreset(key);
  }
  useLayoutEffect(() => {
    if (!pending.current) return;
    const state = pending.current;
    pending.current = null;
    Flip.from(state, { duration: 0.45, ease: "power3.out", targets: list.current?.querySelectorAll("[data-flip]") ?? [], overwrite: true });
  });

  const sum = WEIGHT_KEYS.reduce((a, k) => a + c.weights[k], 0) || 1;
  const setW = (k: (typeof WEIGHT_KEYS)[number], v: number) => update({ ...c, weights: { ...c.weights, [k]: v } });

  return (
    <div className="grid gap-10 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="space-y-6 lg:sticky lg:top-28 lg:self-start">
        <div>
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted">Start from</p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Presets">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" onClick={() => update(p.controls, p.key)} aria-pressed={preset === p.key} title={p.help}
                className={`press rounded-full border px-3 py-1 text-xs font-medium ${preset === p.key ? "border-accent bg-good-soft text-good" : "border-line bg-surface text-muted hover:text-ink"}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <fieldset className="space-y-3 border-t border-line pt-4">
          <legend className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted">What matters</legend>
          {WEIGHT_KEYS.map((k) => (
            <Slider key={k} label={`${k[0]!.toUpperCase()}${k.slice(1)}`} value={c.weights[k]} min={0} max={60} suffix={` → ${Math.round((c.weights[k] / sum) * 100)}%`} onChange={(v) => setW(k, v)} />
          ))}
          <p className="text-[0.7rem] leading-snug text-muted">Weights are relative; they are rescaled to add up to 100, so scores stay on the same 0–100 scale.</p>
        </fieldset>

        <fieldset className="space-y-3 border-t border-line pt-4">
          <legend className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted">How strict</legend>
          <Slider label="“Reach out now” from score" value={c.reachOutNow} min={50} max={95} hint="Production: 75" onChange={(v) => update({ ...c, reachOutNow: v })} />
          <Slider label="“Prepare outreach” from score" value={Math.min(c.prepareOutreach, c.reachOutNow - 1)} min={30} max={90} hint="Production: 55" onChange={(v) => update({ ...c, prepareOutreach: v })} />
          <Slider label="Lead signal must be this relevant" value={c.reachOutMinRelevance} min={30} max={90} hint="Production: 60" onChange={(v) => update({ ...c, reachOutMinRelevance: v })} />
          <Slider label="Social posts count as evidence" value={c.socialPct} min={0} max={100} suffix="%" hint="Production: 60%" onChange={(v) => update({ ...c, socialPct: v })} />
          <Slider label="Adjacent-sector deals capped at" value={c.adjacentCap} min={20} max={90} hint="Production: 45 (relevance out of 100)" onChange={(v) => update({ ...c, adjacentCap: v })} />
          <Slider label="General seed / B2B topics capped at" value={c.softCap} min={30} max={100} hint="Production: 62" onChange={(v) => update({ ...c, softCap: v })} />
        </fieldset>

        <button type="button" onClick={() => update(DEFAULT_CONTROLS, "default")} className="press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent">
          <ArrowCounterClockwise aria-hidden size={14} weight="bold" /> Reset to production rules
        </button>
      </aside>

      <section aria-labelledby="sim-h">
        <div className="grid grid-cols-3 divide-x divide-line border-y border-line text-sm" aria-live="polite">
          <div className="py-3 pr-3"><p className="num text-2xl font-medium">{reach}</p><p className="text-xs text-muted">“Reach out now” <span className="num">(production {baseReach})</span></p></div>
          <div className="px-3 py-3"><p className="num text-2xl font-medium">{changedAction}</p><p className="text-xs text-muted">investors change action</p></div>
          <div className="pl-3 py-3"><p className="num text-2xl font-medium">{moved}</p><p className="text-xs text-muted">change rank</p></div>
        </div>
        <h2 id="sim-h" className="mb-3 mt-6 text-lg font-semibold tracking-tight">Re-ranked: top {SHOWN} of {rows.length}</h2>
        <ol ref={list} className="divide-y divide-line border-y border-line">
          {rows.slice(0, SHOWN).map((x) => {
            const d = x.r.score - x.base.score;
            const dr = x.baseRank - x.rank;
            return (
              <li key={x.i.id} data-flip={x.i.id} className="bg-bg">
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 py-3 [&::-webkit-details-marker]:hidden">
                    <span className="num w-6 text-xs text-muted">{x.rank}</span>
                    <span className="num w-10 text-2xl font-medium">{x.r.score}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{x.i.firm_name}</span>
                      <span className="ml-2 text-xs text-muted">{ENTITY_LABEL[x.i.entity_type]}</span>
                    </span>
                    <span className={`num w-14 text-xs ${d === 0 ? "text-muted" : d > 0 ? "text-good" : "text-warn"}`} title="Score change against the production rules">{d === 0 ? "same" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}`}</span>
                    <span className={`num w-12 text-xs ${dr === 0 ? "text-muted" : dr > 0 ? "text-good" : "text-warn"}`} title="Rank change against the production rules">{dr === 0 ? "—" : `${dr > 0 ? "↑" : "↓"}${Math.abs(dr)}`}</span>
                    <span className="flex w-52 justify-end"><Pill tone={ACTION_TONE[x.r.action]}>{ACTION_LABEL[x.r.action]}</Pill></span>
                  </summary>
                  <div className="pb-4 pl-10 pr-2">
                    <p className="max-w-[70ch] text-sm leading-relaxed text-muted">{x.r.explanation}</p>
                    <div className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                      {WEIGHT_KEYS.map((k, n) => <Bar key={k} label={k} index={n} {...x.r.breakdown[k]} />)}
                    </div>
                    <Link href={`/investors/${x.i.id}`} className="mt-3 inline-block text-sm font-medium text-accent hover:underline">Open the evidence →</Link>
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 max-w-[70ch] text-xs leading-relaxed text-muted">
          This is a what-if, not a change: it re-scores the stored evidence in your browser with the weights above ({Object.values(cfg.weights).map((w) => Math.round(w)).join("/")} for recency, relevance, evidence, fit, relationship). The dashboard and the database keep the production rules.
          Investors with no checked data are not shown.
        </p>
      </section>
    </div>
  );
}
