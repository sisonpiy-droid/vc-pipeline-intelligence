import { NextRequest, NextResponse } from "next/server";
import { isCron } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { rescoreAll } from "@/lib/refresh/rescore";
import { asRefresh } from "@/lib/refresh/write";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Re-score every checked investor from the evidence already stored: no search credits, no model calls. Applies the
 * passage of time (recency decays daily) and any scoring-rule change. Secret-protected like the other operational
 * endpoints, and it refuses to run while a refresh is in progress.
 */
export async function POST(req: NextRequest) {
  if (!isCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rdb = asRefresh(getDb());
  if ((await rdb.query(`select 1 from runs where status = 'running'`)).rowCount > 0) return NextResponse.json({ error: "refresh_in_progress" }, { status: 409 });
  return NextResponse.json(await rescoreAll(rdb, new Date()));
}
