import { after, NextRequest, NextResponse } from "next/server";
import { checkAdmin, clientIp } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { missingEnv, REFRESH_ENV } from "@/lib/env";
import { planFromEnv, productionDeps, triggerRefresh, work } from "@/lib/refresh/service";
import { asRefresh } from "@/lib/refresh/write";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Manual refresh from the dashboard. Requires the ADMIN_PASSCODE; disabled entirely if it is not configured. */
export async function POST(req: NextRequest) {
  const auth = checkAdmin(req, clientIp(req));
  if (auth === "disabled")
    return NextResponse.json({ error: "manual_refresh_disabled", message: "Set ADMIN_PASSCODE on the server to enable manual refresh." }, { status: 503 });
  if (auth === "locked") return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  if (auth === "denied") {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const missing = missingEnv(REFRESH_ENV);
  if (missing.length) return NextResponse.json({ error: "server_misconfigured", missing }, { status: 500 });

  const rdb = asRefresh(getDb());
  // Optional JSON body {"linkedin": true}: also search LinkedIn (roughly doubles the credits this run uses).
  const body = (await req.json().catch(() => null)) as { linkedin?: unknown } | null;
  const r = await triggerRefresh(rdb, "manual", planFromEnv({ linkedin: body?.linkedin === true }));
  if (r.state === "throttled") return NextResponse.json(r, { status: 429, headers: { "retry-after": String(r.retry_after_s) } });
  if (r.state === "already_running" || r.state === "nothing_due") return NextResponse.json(r, { status: 200 });
  after(() => work(rdb, productionDeps(), r.run_id, req.nextUrl.origin));
  return NextResponse.json(r, { status: 202 });
}
