import type { Db } from "@/lib/db";
import { listPipeline, type PipelineRow } from "./read";

export const MAX_COMPARE = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?ids=a,b,c` → at most three distinct, well-formed ids, in the order given. Anything else is dropped. */
export function parseIds(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, MAX_COMPARE);
}

export interface CompareItem {
  row: PipelineRow;
  stage: string | null;
  sectors: string[];
  geography: string | null;
  thesis_verified: boolean;
  entity_note: string | null;
  recent_scores: number[]; // oldest first
}

export async function getCompare(db: Db, ids: string[], today: string): Promise<CompareItem[]> {
  if (ids.length === 0) return [];
  const pipeline = await listPipeline(db, today);
  const profiles = (await db.query<{ id: string; stage_preference: string | null; sectors: string[]; geography: string | null; thesis_verified: boolean; role_title: string | null }>(
    `select id, stage_preference, sectors, geography, thesis_verified, role_title from investors where id = any($1::uuid[])`, [ids],
  )).rows;
  const trend = (await db.query<{ investor_id: string; score: number }>(
    `select investor_id, score from (
       select investor_id, score, at, id, row_number() over (partition by investor_id order by at desc, id desc) as rn
         from score_history where investor_id = any($1::uuid[])) t
      where rn <= 6 order by investor_id, at, id`, [ids],
  )).rows;
  return ids.flatMap((id) => {
    const row = pipeline.find((r) => r.id === id);
    const p = profiles.find((x) => x.id === id);
    if (!row || !p) return [];
    return [{
      row, stage: p.stage_preference, sectors: p.sectors, geography: p.geography, thesis_verified: p.thesis_verified, entity_note: p.role_title,
      recent_scores: trend.filter((t) => t.investor_id === id).map((t) => t.score),
    }];
  });
}
