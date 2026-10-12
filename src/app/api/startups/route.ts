import { NextRequest, NextResponse } from "next/server";
import { createGemini } from "@/lib/ai/gemini";
import { getDb } from "@/lib/db";
import { generateRubric } from "@/lib/startups/generate";
import { guard, MAX_STARTUPS } from "@/lib/startups/guard";
import { ProfileSchema } from "@/lib/startups/rubric";
import { createStartup } from "@/lib/startups/store";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Create a startup and have Gemini draft its rubric. No search runs and no search credit is used; the evaluation is a separate, explicit step. */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  const parsed = ProfileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_profile", issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) }, { status: 400 });
  const db = getDb();
  const n = Number((await db.query<{ n: number }>("select count(*)::int as n from startups")).rows[0]?.n ?? 0);
  if (n >= MAX_STARTUPS) return NextResponse.json({ error: "limit", message: `At most ${MAX_STARTUPS} startups; delete one first.` }, { status: 409 });
  const gen = await generateRubric(createGemini(), parsed.data);
  const s = await createStartup(db, parsed.data, gen);
  return NextResponse.json({ slug: s.slug, rubric_source: gen.source, note: gen.note }, { status: 201 });
}
