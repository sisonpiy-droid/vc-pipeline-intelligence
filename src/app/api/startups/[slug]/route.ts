import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { guard } from "@/lib/startups/guard";

export const dynamic = "force-dynamic";

/** Delete a startup and everything stored for it (rubric, judgements, scores). Shared investors and evidence are untouched. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const r = await getDb().query("delete from startups where slug = $1", [(await ctx.params).slug]);
  return NextResponse.json({ deleted: r.rowCount }, { status: r.rowCount ? 200 : 404 });
}
