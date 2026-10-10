import { after, NextRequest, NextResponse } from "next/server";
import { isCron } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { missingEnv, REFRESH_ENV } from "@/lib/env";
import { productionDeps, triggerRefresh, work } from "@/lib/refresh/service";
import { asRefresh } from "@/lib/refresh/write";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Scheduled refresh. Vercel Cron calls this with GET + `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  if (!isCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const missing = missingEnv(REFRESH_ENV);
  if (missing.length) return NextResponse.json({ error: "server_misconfigured", missing }, { status: 500 });

  const rdb = asRefresh(getDb());
  const r = await triggerRefresh(rdb, "cron");
  if (r.state === "throttled") return NextResponse.json(r, { status: 429 }); // never true for cron; keeps the type honest
  if (r.state === "already_running") return NextResponse.json(r, { status: 200 }); // an overlapping trigger is a no-op
  after(() => work(rdb, productionDeps(), r.run_id, req.nextUrl.origin));
  return NextResponse.json(r, { status: 202 });
}
