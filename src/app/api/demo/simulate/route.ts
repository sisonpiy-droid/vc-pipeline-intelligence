import { NextRequest, NextResponse } from "next/server";
import { checkAdmin, clientIp } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { demoExists, resetDemo, simulateRun } from "@/lib/demoData/seed";

export const dynamic = "force-dynamic";

/** A simulated refresh over the demo investors: re-scores stored synthetic evidence. Makes no search or AI call and spends no credits. */
export async function POST(req: NextRequest) {
  const auth = checkAdmin(req, clientIp(req));
  if (auth === "disabled") return NextResponse.json({ error: "disabled", message: "Set ADMIN_PASSCODE on the server to enable this." }, { status: 503 });
  if (auth === "locked") return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  if (auth === "denied") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const db = getDb();
    if (!(await demoExists(db))) await resetDemo(db);
    return NextResponse.json({ ...(await simulateRun(db)), simulated: true });
  } catch (e) {
    console.error("[demo simulate failed]", String((e as Error).message).slice(0, 200));
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
