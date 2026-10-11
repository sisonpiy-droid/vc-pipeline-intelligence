import { NextRequest, NextResponse } from "next/server";
import { checkAdmin, clientIp } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { FounderEditError, applyFounderEdit } from "@/lib/founder";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Edit the founder-owned fields of one investor. Same passcode and brute-force lockout as the manual refresh. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = checkAdmin(req, clientIp(req));
  if (auth === "disabled") return NextResponse.json({ error: "editing_disabled", message: "Set ADMIN_PASSCODE on the server to enable editing." }, { status: 503 });
  if (auth === "locked") return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  if (auth === "denied") {
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  try {
    const fields = await applyFounderEdit(getDb(), id, await req.json().catch(() => null));
    return NextResponse.json({ updated: fields });
  } catch (e) {
    if (e instanceof FounderEditError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.code === "not_found" ? 404 : 400 });
    console.error("[founder edit failed]", (e as Error).message?.slice(0, 200));
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
