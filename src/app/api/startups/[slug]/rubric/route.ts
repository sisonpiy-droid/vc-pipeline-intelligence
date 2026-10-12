import { NextRequest, NextResponse } from "next/server";
import { createGemini } from "@/lib/ai/gemini";
import { getDb } from "@/lib/db";
import { rescoreStartup } from "@/lib/startups/evaluate";
import { generateRubric } from "@/lib/startups/generate";
import { guard } from "@/lib/startups/guard";
import { defaultRubric, sanitizeRubric } from "@/lib/startups/rubric";
import { getStartup, profileOf, saveRubric, setStep } from "@/lib/startups/store";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const sameTopic = (a: { market: object; definitions: object }, b: { market: object; definitions: object }) =>
  JSON.stringify([a.market, a.definitions]) === JSON.stringify([b.market, b.definitions]);

/**
 * {action: "regenerate"} asks Gemini for a new rubric; {rubric} saves the founder's edits (clamped by code).
 * Changing only numbers or keywords re-scores at once from the cached judgements (free). Changing what a topic class
 * means invalidates those judgements, so they are cleared and the next evaluation asks Gemini again.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const db = getDb();
  const s = await getStartup(db, (await ctx.params).slug);
  if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { action?: string; rubric?: unknown } | null;

  let next, source: "gemini" | "default" | "edited", note: string | null = null;
  if (body?.action === "regenerate") {
    const g = await generateRubric(createGemini(), profileOf(s));
    // A failed attempt must not replace a rubric Gemini already wrote with the plain default.
    if (g.source === "default" && s.rubric_source !== "default") return NextResponse.json({ error: "gemini_failed", note: g.note, message: "Gemini could not write a new rubric; the current one is kept." }, { status: 502 });
    next = g.rubric; source = g.source; note = g.note;
  } else if (body?.rubric) {
    next = sanitizeRubric(body.rubric, defaultRubric(profileOf(s))); source = "edited";
  } else return NextResponse.json({ error: "bad_request" }, { status: 400 });

  await saveRubric(db, s.id, next, source, note);
  if (sameTopic(s.rubric, next)) {
    const had = (await db.query("select 1 from startup_scores where startup_id = $1 limit 1", [s.id])).rowCount > 0;
    if (had) await rescoreStartup(db, { ...s, rubric: next });
    return NextResponse.json({ rubric_source: source, note, rescored: had, needs_evaluation: !had });
  }
  await db.query("delete from startup_signal_reviews where startup_id = $1", [s.id]);
  await db.query("delete from startup_scores where startup_id = $1", [s.id]);
  for (const step of ["judge", "score"] as const) await setStep(db, s.id, step, "pending", "The topic classes changed, so the signals must be judged again. Press “Run evaluation”.");
  return NextResponse.json({ rubric_source: source, note, rescored: false, needs_evaluation: true });
}
