import { z } from "zod";
import type { Db, Queryable } from "@/lib/db";

/**
 * THE ONLY function that writes to `investors` during a refresh.
 *
 * Layers of protection (any one of them stops a bad write):
 *  1. This allowlist + a strict schema: unknown keys (personal_notes, relationship_status, ...) are rejected.
 *  2. The SQL is built from SIGNAL_COLUMNS only — never from the incoming object's keys.
 *  3. The database: the refresh runs as role `vc_refresh`, which has UPDATE on exactly these four columns.
 */
export const SIGNAL_COLUMNS = ["last_signal_date", "signal_summary", "follow_up_score", "recommended_action"] as const;

export const ACTIONS = ["reach_out_now", "prepare_targeted_outreach", "wait_for_response", "research_further", "no_action"] as const;

export const SignalUpdateSchema = z
  .object({
    last_signal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    signal_summary: z.string().max(500).nullable(),
    follow_up_score: z.number().int().min(0).max(100),
    recommended_action: z.enum(ACTIONS),
  })
  .strict();
export type SignalUpdate = z.infer<typeof SignalUpdateSchema>;

/** Model- or web-derived text that ends up in a database column: single line, no control characters, bounded. */
export function sanitizeSummary(s: string, max = 500): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Returns true when the row actually changed (a no-op refresh writes nothing). */
export async function applySignalUpdate(q: Queryable, investorId: string, update: unknown): Promise<boolean> {
  const u = SignalUpdateSchema.parse(update); // throws on any extra / invalid field — nothing reaches SQL
  const sets = SIGNAL_COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(", ");
  const types = ["date", "text", "smallint", "text"];
  const cmp = SIGNAL_COLUMNS.map((_, i) => `$${i + 2}::${types[i]}`).join(", ");
  const res = await q.query(
    `update investors set ${sets}
      where id = $1 and (${SIGNAL_COLUMNS.join(", ")}) is distinct from (${cmp})`,
    [investorId, ...SIGNAL_COLUMNS.map((c) => u[c])],
  );
  return res.rowCount > 0;
}

/**
 * A Db whose every statement runs as the restricted `vc_refresh` role. All refresh code receives this,
 * so an accidental `select personal_notes` or `update investors set relationship_status` anywhere in the
 * pipeline fails at the database instead of silently succeeding.
 */
export function asRefresh(db: Db): Db {
  return {
    query: (sql, params) => db.tx((q) => q.query(sql, params), { role: "vc_refresh" }),
    exec: () => Promise.reject(new Error("exec is not available to the refresh role")),
    tx: (fn) => db.tx(fn, { role: "vc_refresh" }),
    close: () => db.close(),
  };
}
