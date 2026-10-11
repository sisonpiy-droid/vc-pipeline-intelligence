import { NextResponse } from "next/server";
import { isDemoView } from "@/lib/demoData/mode";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Names and scores for the Ctrl+K palette: the same facts the pipeline page shows. Never notes or contact history. */
export async function GET() {
  try {
    const demo = await isDemoView();
    const { rows } = await getDb().query<{ id: string; name: string; type: string; score: number | null; action: string | null }>(
      `select id, firm_name as name, entity_type as type, follow_up_score as score, recommended_action as action
         from investors where is_demo = $1 order by follow_up_score desc nulls last, firm_name`, [demo],
    );
    return NextResponse.json({ investors: rows }, { headers: { "cache-control": "private, max-age=60" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
