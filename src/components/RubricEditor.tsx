"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SECTOR_KEYS, SECTOR_LABEL, type Rubric } from "@/lib/startups/rubric";
import { callApi, failure, PassField, TONE, type Msg } from "./startupApi";

const NUM = "mt-1 w-20 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm num";
const AREA = "mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm";
const list = (s: string) => s.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);

/** Edit the rubric. The server clamps everything again, so a typo cannot break the scoring. Number and keyword edits re-score at once. */
export function RubricEditor({ slug, rubric, needPass }: { slug: string; rubric: Rubric; needPass: boolean }) {
  const router = useRouter();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => Number(f.get(k));
    const t = (k: string) => list(String(f.get(k) ?? ""));
    const edited: Rubric = {
      ...rubric,
      market: { sector: String(f.get("market.sector")), core: String(f.get("market.core")) },
      definitions: Object.fromEntries(SECTOR_KEYS.map((k) => [k, String(f.get(`def.${k}`))])) as Rubric["definitions"],
      weights: { recency: n("w.recency"), relevance: n("w.relevance"), evidence: n("w.evidence"), fit: n("w.fit"), relationship: n("w.relationship") },
      thresholds: { reachOutNow: n("t.reach"), prepareOutreach: n("t.prepare") },
      reachOutMinRelevance: n("minrel"),
      sectorCap: { logistics: 100, b2b_software: n("cap.b2b_software"), seed_generalist: n("cap.seed_generalist"), adjacent: n("cap.adjacent"), unrelated: n("cap.unrelated") },
      fit: { coreTerms: t("fit.coreTerms"), adjacentTerms: t("fit.adjacentTerms"), stageBest: t("fit.stageBest"), stageOk: t("fit.stageOk"), stagePoor: t("fit.stagePoor"), geographyTerms: t("fit.geographyTerms") },
    };
    setBusy(true);
    setMsg(null);
    const r = await callApi(`/api/startups/${slug}/rubric`, "POST", { rubric: edited }, pass);
    setBusy(false);
    if (r.status === 200) {
      setMsg({ tone: "good", text: r.data.rescored ? "Saved. Every score was recalculated from your rubric." : r.data.needs_evaluation ? "Saved. Press “Run evaluation” to apply it." : "Saved." });
      router.refresh();
    } else setMsg(failure(r.status, r.data));
  }

  const w = rubric.weights;
  return (
    <form onSubmit={save} className="space-y-6">
      <fieldset>
        <legend className="text-sm font-medium">Weights <span className="font-normal text-muted">(rescaled to total 100)</span></legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {(["recency", "relevance", "evidence", "fit", "relationship"] as const).map((k) => (
            <label key={k} className="text-xs capitalize text-muted">{k}<input name={`w.${k}`} type="number" min={0} max={60} defaultValue={w[k]} className={`${NUM} block`} /></label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium">Thresholds</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          <label className="text-xs text-muted">Reach out now at<input name="t.reach" type="number" min={60} max={90} defaultValue={rubric.thresholds.reachOutNow} className={`${NUM} block`} /></label>
          <label className="text-xs text-muted">Prepare outreach at<input name="t.prepare" type="number" min={35} max={85} defaultValue={rubric.thresholds.prepareOutreach} className={`${NUM} block`} /></label>
          <label className="text-xs text-muted">Lead signal must be this relevant<input name="minrel" type="number" min={50} max={80} defaultValue={rubric.reachOutMinRelevance} className={`${NUM} block`} /></label>
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium">Topic classes <span className="font-normal text-muted">(what each means for this startup, and the highest relevance a signal in it may have)</span></legend>
        <div className="mt-2 space-y-3">
          {SECTOR_KEYS.map((k) => (
            <div key={k} className="grid gap-2 sm:grid-cols-[11rem_1fr_5rem] sm:items-start">
              <span className="pt-2 text-sm">{SECTOR_LABEL[k]}</span>
              <textarea name={`def.${k}`} rows={2} defaultValue={rubric.definitions[k]} aria-label={`${SECTOR_LABEL[k]}: meaning`} className={AREA} />
              {k === "logistics" ? <span className="num pt-2 text-sm text-muted">cap 100</span> : <input name={`cap.${k}`} type="number" min={0} max={80} defaultValue={rubric.sectorCap[k]} aria-label={`${SECTOR_LABEL[k]}: cap`} className={NUM} />}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Changing what a class means makes Gemini read the evidence again on the next evaluation. Changing only numbers or keywords re-scores immediately, for free.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted">Market, in short<input name="market.sector" defaultValue={rubric.market.sector} className={`${AREA} block`} /></label>
          <label className="text-xs text-muted">Core market in a sentence (“not …”)<input name="market.core" defaultValue={rubric.market.core} className={`${AREA} block`} /></label>
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium">Investor fit keywords <span className="font-normal text-muted">(comma separated)</span></legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {([["coreTerms", "Sector: full fit"], ["adjacentTerms", "Sector: partial fit"], ["stageBest", "Stage: best"], ["stageOk", "Stage: acceptable"], ["stagePoor", "Stage: poor"], ["geographyTerms", "Geography (empty = anywhere)"]] as const).map(([k, label]) => (
            <label key={k} className="text-xs text-muted">{label}<textarea name={`fit.${k}`} rows={2} defaultValue={rubric.fit[k].join(", ")} className={`${AREA} block`} /></label>
          ))}
        </div>
      </fieldset>
      {needPass && <PassField pass={pass} setPass={setPass} />}
      <button disabled={busy || (needPass && !pass)} className="press rounded-lg bg-ink px-4 py-2 text-sm font-medium text-bg disabled:opacity-50">{busy ? "Saving…" : "Save rubric and re-score"}</button>
      {msg && <p role="status" className={`text-sm leading-relaxed ${TONE[msg.tone]}`}>{msg.text}</p>}
    </form>
  );
}
