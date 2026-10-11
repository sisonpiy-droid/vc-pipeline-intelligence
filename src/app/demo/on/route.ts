import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { MODE_COOKIE } from "@/lib/demoData/mode";
import { demoExists, resetDemo } from "@/lib/demoData/seed";

export const dynamic = "force-dynamic";

/** Switches this browser to the demo view (synthetic data only), creating the demo investors the first time. Sets one cookie; changes no real data. */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    if (!(await demoExists(db))) await resetDemo(db);
  } catch (e) {
    console.error("[demo seed failed]", String((e as Error).message).slice(0, 200));
    return NextResponse.json({ error: "demo_unavailable", message: "Demo data could not be created. Has the latest migration been applied?" }, { status: 503 });
  }
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(MODE_COOKIE, "demo", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 });
  return res;
}
