import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isCron } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { productionDeps, work } from "@/lib/refresh/service";
import { asRefresh } from "@/lib/refresh/write";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const Body = z.object({ run_id: z.string().uuid(), chain: z.number().int().min(1).max(50) });

/** Internal hand-off: continue a run that did not fit in one invocation. Secret-protected, returns immediately. */
export async function POST(req: NextRequest) {
  if (!isCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const rdb = asRefresh(getDb());
  after(() => work(rdb, productionDeps(), body.data.run_id, req.nextUrl.origin, body.data.chain));
  return NextResponse.json({ accepted: true }, { status: 202 });
}
