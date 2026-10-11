import { z } from "zod";
import type { Db } from "@/lib/db";

/**
 * The founder-owned half of the CRM. These are the ONLY investor columns this module can write, and it is the
 * mirror image of the refresh boundary: the refresh role can never touch them, and this path can never touch
 * the signal-derived columns, the profile, or identity. It runs as the database owner (the refresh role cannot
 * write these columns at all), behind the admin passcode.
 */
export const FOUNDER_COLUMNS = ["relationship_status", "last_contact_date", "contact_history", "personal_notes"] as const;

export const RELATIONSHIP = ["not_contacted", "contacted", "in_conversation", "awaiting_response", "passed", "committed"] as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, "not a real date");

export const FounderEditSchema = z
  .object({
    relationship_status: z.enum(RELATIONSHIP).optional(),
    last_contact_date: day.nullable().optional(),
    /** Appends one entry to contact_history (history is never rewritten or deleted here). */
    add_contact: z.object({ date: day.nullable().optional(), channel: z.string().trim().max(40).optional(), note: z.string().trim().min(1).max(500) }).strict().optional(),
    personal_notes: z.string().max(5000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "nothing to change");
export type FounderEdit = z.infer<typeof FounderEditSchema>;

export class FounderEditError extends Error {
  constructor(public code: "not_found" | "invalid", message: string) {
    super(message);
  }
}

/** Applies one validated edit. Returns the names of the fields that were changed (never their values). */
export async function applyFounderEdit(db: Db, investorId: string, input: unknown): Promise<string[]> {
  const parsed = FounderEditSchema.safeParse(input);
  if (!parsed.success) throw new FounderEditError("invalid", parsed.error.issues.map((i) => `${i.path.join(".") || "edit"}: ${i.message}`).join("; "));
  const e = parsed.data;

  const sets: string[] = [];
  const params: unknown[] = [investorId];
  const fields: string[] = [];
  const add = (column: (typeof FOUNDER_COLUMNS)[number], expr: (p: string) => string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = ${expr(`$${params.length}`)}`);
    fields.push(column);
  };
  if (e.relationship_status !== undefined) add("relationship_status", (p) => p, e.relationship_status);
  if (e.last_contact_date !== undefined) add("last_contact_date", (p) => `${p}::date`, e.last_contact_date);
  if (e.personal_notes !== undefined) add("personal_notes", (p) => p, e.personal_notes === "" ? null : e.personal_notes);
  if (e.add_contact) add("contact_history", (p) => `contact_history || ${p}::jsonb`, JSON.stringify([{ date: e.add_contact.date ?? null, channel: e.add_contact.channel || null, note: e.add_contact.note }]));

  return db.tx(async (q) => {
    const res = await q.query(`update investors set ${sets.join(", ")} where id = $1`, params);
    if (res.rowCount === 0) throw new FounderEditError("not_found", "investor not found");
    // Field names only: the audit trail must never copy notes or contact history.
    await q.query(`insert into audit_logs (investor_id, event, detail) values ($1, 'founder_edit', $2::jsonb)`, [investorId, JSON.stringify({ fields })]);
    return fields;
  });
}
