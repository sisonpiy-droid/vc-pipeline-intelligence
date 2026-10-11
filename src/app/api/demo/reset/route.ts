import { NextRequest, NextResponse } from "next/server";
import { checkAdmin, clientIp } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { resetDemo } from "@/lib/demoData/seed";

export const dynamic = "force-dynamic";

/** Deletes the demo investors (and only those) and recreates them. Real investors, signals, runs and founder data are never touched. */
export async function POST(req: NextRequest) {
  const auth = checkAdmin(req, clientIp(req));
  if (auth === "disabled") return NextResponse.json({ error: "disabled", message: "Set ADMIN_PASSCODE on the server to enable this." }, { status: 503 });
  if (auth === "locked") return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  if (auth === "denied") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ...(await resetDemo(getDb())), demo: true });
  } catch (e) {
    console.error("[demo reset failed]", String((e as Error).message).slice(0, 200));
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
