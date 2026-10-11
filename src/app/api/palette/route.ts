import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Names and scores for the Ctrl+K palette: the same facts the pipeline page shows. Never notes or contact history. */
export async function GET() {
  try {
    const { rows } = await getDb().query<{ id: string; name: string; type: string; score: number | null; action: string | null }>(
      `select id, firm_name as name, entity_type as type, follow_up_score as score, recommended_action as action
         from investors order by follow_up_score desc nulls last, firm_name`,
    );
    return NextResponse.json({ investors: rows }, { headers: { "cache-control": "private, max-age=60" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
