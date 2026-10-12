"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, failure, PassField, TONE, type Msg } from "./startupApi";

/** Run the evaluation, ask Gemini for a new rubric, or delete the startup. */
export function StartupActions({ slug, needPass, running, hasResults }: { slug: string; needPass: boolean; running: boolean; hasResults: boolean }) {
  const router = useRouter();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function act(kind: "evaluate" | "regenerate" | "delete") {
    setBusy(kind);
    setMsg(null);
    const r = kind === "evaluate" ? await callApi(`/api/startups/${slug}/evaluate`, "POST", {}, pass)
      : kind === "regenerate" ? await callApi(`/api/startups/${slug}/rubric`, "POST", { action: "regenerate" }, pass)
      : await callApi(`/api/startups/${slug}`, "DELETE", undefined, pass);
    setBusy(null);
    if (kind === "delete" && r.status === 200) return router.push("/startups");
    if (r.status === 202) setMsg({ tone: "good", text: "Started. The workflow below updates as each step finishes." });
    else if (r.status === 200 && r.data.state === "already_running") setMsg({ tone: "warn", text: "An evaluation is already running; showing its progress." });
    else if (r.status === 200) setMsg({ tone: "good", text: r.data.rubric_source === "gemini" ? "Gemini wrote a new rubric. Press “Run evaluation” to judge the evidence with it." : "A default rubric is in use because Gemini could not write one." });
    else setMsg(failure(r.status, r.data));
    if (r.status < 300 && r.status > 0) router.refresh();
  }

  const btn = "press rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-50";
  return (
    <div className="space-y-4">
      {needPass && <PassField pass={pass} setPass={setPass} />}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => act("evaluate")} disabled={!!busy || running || (needPass && !pass)} className={`${btn} bg-accent text-white dark:text-black`}>
          {running ? "Evaluation running…" : busy === "evaluate" ? "Starting…" : hasResults ? "Run the evaluation again" : "Run evaluation"}
        </button>
        <button onClick={() => act("regenerate")} disabled={!!busy || running || (needPass && !pass)} className={`${btn} border border-line`}>
          {busy === "regenerate" ? "Gemini is writing…" : "Write a new rubric with Gemini"}
        </button>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} disabled={!!busy || running} className={`${btn} text-muted hover:text-bad`}>Delete startup</button>
        ) : (
          <span className="flex items-center gap-2 text-sm">
            Delete this startup and its scores?
            <button onClick={() => act("delete")} disabled={!!busy || (needPass && !pass)} className={`${btn} bg-bad-soft text-bad`}>Yes, delete</button>
            <button onClick={() => setConfirmDelete(false)} className={`${btn} text-muted`}>Cancel</button>
          </span>
        )}
      </div>
      <p className="max-w-[65ch] text-xs leading-relaxed text-muted">
        The evaluation reads evidence that is already collected. Gemini judges each signal against this startup (about 30 to 60 short calls, cached, so a second run costs none), then the scores are calculated by fixed rules. It does not search the web, so it uses no Tavily credits.
      </p>
      {msg && <p role="status" className={`text-sm leading-relaxed ${TONE[msg.tone]}`}>{msg.text}</p>}
    </div>
  );
}
