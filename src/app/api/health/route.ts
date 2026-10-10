import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { missingEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness + configuration presence (booleans only — never values). */
export async function GET() {
  let database = false;
  try {
    await getDb().query("select 1");
    database = true;
  } catch {
    /* reported below */
  }
  const configured = {
    database,
    gemini: missingEnv(["GEMINI_API_KEY"]).length === 0,
    search: missingEnv(["TAVILY_API_KEY"]).length === 0,
    cron_secret: missingEnv(["CRON_SECRET"]).length === 0,
    manual_refresh: missingEnv(["ADMIN_PASSCODE"]).length === 0,
  };
  return NextResponse.json({ ok: database, configured }, { status: database ? 200 : 503 });
}
