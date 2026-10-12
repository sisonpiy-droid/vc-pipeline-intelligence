import { NextResponse } from "next/server";
import { checkAdmin, clientIp } from "@/lib/auth";

/** The same admin check the manual refresh uses (passcode header, or open demo mode). Null = allowed. */
export async function guard(req: Request): Promise<NextResponse | null> {
  const auth = checkAdmin(req, clientIp(req));
  if (auth === "ok") return null;
  if (auth === "disabled") return NextResponse.json({ error: "disabled", message: "Set ADMIN_PASSCODE on the server to enable this." }, { status: 503 });
  if (auth === "locked") return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  await new Promise((r) => setTimeout(r, 400)); // slow down guessing
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** A startup costs Gemini calls to create and evaluate; this bounds how many can exist. */
export const MAX_STARTUPS = 25;
