import { NextRequest, NextResponse } from "next/server";
import { createAi } from "@/lib/ai/chain";
import { clientIp } from "@/lib/auth";
import { answerQuestion, ChatInput } from "@/lib/chat/chat";
import { allow } from "@/lib/chat/limit";
import { getDb } from "@/lib/db";
import { isDemoView } from "@/lib/demoData/mode";
import { today } from "@/lib/page";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Ask a question about the pipeline. Gemini Flash answers from the dashboard's own facts only (never notes, contact history or
 * contact emails). Public, like the dashboard it reads, so it is rate-limited per visitor. If Gemini is unavailable the reply is
 * the plain summary of the same data, labelled as such.
 */
export async function POST(req: NextRequest) {
  const limit = allow(clientIp(req));
  if (!limit.ok) return NextResponse.json({ error: "rate_limited", message: `That is a lot of questions. Try again in ${Math.ceil(limit.retryAfterS / 60)} min.` }, { status: 429, headers: { "retry-after": String(limit.retryAfterS) } });
  const parsed = ChatInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid question" }, { status: 400 });
  try {
    const reply = await answerQuestion(getDb(), createAi(), parsed.data, { today: today(), scope: (await isDemoView()) ? true : false });
    return NextResponse.json(reply, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[chat failed]", String((e as Error).message ?? e).slice(0, 200));
    return NextResponse.json({ error: "unavailable", message: "The assistant could not read the pipeline just now. Try again in a moment." }, { status: 503 });
  }
}
