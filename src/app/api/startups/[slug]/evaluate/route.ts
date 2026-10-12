import { after, NextRequest, NextResponse } from "next/server";
import { createAi } from "@/lib/ai/chain";
import { getDb } from "@/lib/db";
import { evaluateStartup } from "@/lib/startups/evaluate";
import { guard } from "@/lib/startups/guard";
import { getStartup, getSteps, setStep } from "@/lib/startups/store";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Judge the stored evidence against this startup with Gemini, then score it. No search is run: no Tavily credit is used. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const db = getDb();
  const s = await getStartup(db, (await ctx.params).slug);
  if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const running = (await getSteps(db, s.id)).some((x) => x.status === "running" && x.started_at && Date.now() - new Date(x.started_at).getTime() < 10 * 60_000);
  if (running) return NextResponse.json({ state: "already_running" }, { status: 200 });
  await setStep(db, s.id, "candidates", "running", "Starting…");
  after(async () => {
    try {
      await evaluateStartup(db, createAi(), s);
    } catch (e) {
      console.error("[startup evaluation failed]", String((e as Error).message ?? e).slice(0, 300));
      await setStep(db, s.id, "score", "failed", "The evaluation stopped because of an unexpected error. Run it again.").catch(() => {});
    }
  });
  return NextResponse.json({ state: "started" }, { status: 202 });
}
