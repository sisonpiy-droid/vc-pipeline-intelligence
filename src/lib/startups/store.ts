import type { Queryable } from "@/lib/db";
import { defaultRubric, sanitizeRubric, slugify, type Rubric, type Stage, type StartupProfile } from "./rubric";
import type { GeneratedRubric } from "./generate";

export const STEPS = ["profile", "rubric", "candidates", "evidence", "judge", "score"] as const;
export type Step = (typeof STEPS)[number];
export type StepStatus = "pending" | "running" | "done" | "partial" | "failed";

export interface StartupRow {
  id: string;
  slug: string;
  name: string;
  pitch: string;
  sector: string;
  stage: Stage;
  geography: string;
  round_size: string | null;
  ask: string | null;
  rubric: Rubric;
  rubric_source: "gemini" | "default" | "edited";
  rubric_note: string | null;
  created_at: string;
}

export interface StepRow { step: Step; status: StepStatus; detail: string | null; stats: Record<string, unknown>; started_at: string | null; finished_at: string | null }

const COLS = `id, slug, name, pitch, sector, stage, geography, round_size, ask, rubric, rubric_source, rubric_note, created_at::text as created_at`;

export const profileOf = (s: StartupRow): StartupProfile => ({ name: s.name, pitch: s.pitch, sector: s.sector, stage: s.stage, geography: s.geography, round_size: s.round_size, ask: s.ask });

export async function setStep(q: Queryable, id: string, step: Step, status: StepStatus, detail: string | null, stats: Record<string, unknown> = {}): Promise<void> {
  await q.query(
    `insert into startup_steps (startup_id, step, status, detail, stats, started_at, finished_at)
     values ($1, $2, $3, $4, $5::jsonb, now(), case when $3 in ('running', 'pending') then null else now() end)
     on conflict (startup_id, step) do update set status = excluded.status, detail = excluded.detail, stats = excluded.stats,
       started_at = case when excluded.status = 'running' then now() else coalesce(startup_steps.started_at, now()) end,
       finished_at = excluded.finished_at`,
    [id, step, status, detail, JSON.stringify(stats)],
  );
}

export async function createStartup(q: Queryable, profile: StartupProfile, gen: GeneratedRubric): Promise<StartupRow> {
  const base = slugify(profile.name);
  let slug = base;
  for (let n = 2; (await q.query("select 1 from startups where slug = $1", [slug])).rowCount > 0; n++) slug = `${base}-${n}`;
  const row = (await q.query<StartupRow>(
    `insert into startups (slug, name, pitch, sector, stage, geography, round_size, ask, rubric, rubric_source, rubric_note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11) returning ${COLS}`,
    [slug, profile.name, profile.pitch, profile.sector, profile.stage, profile.geography, profile.round_size, profile.ask, JSON.stringify(gen.rubric), gen.source, gen.note],
  )).rows[0]!;
  await setStep(q, row.id, "profile", "done", "Saved.");
  await setRubricStep(q, row.id, gen.source, gen.note);
  return row;
}

export async function setRubricStep(q: Queryable, id: string, source: "gemini" | "default" | "edited", note: string | null): Promise<void> {
  if (source === "gemini") await setStep(q, id, "rubric", "done", "Written by Gemini Flash from the profile, then checked and clamped by code. Review it below.");
  else if (source === "edited") await setStep(q, id, "rubric", "done", "Edited by you; the scores were recalculated from it.");
  else await setStep(q, id, "rubric", "partial", `Gemini could not write the rubric (${note ?? "unavailable"}), so a plain default built from the profile is in use. Edit it, or try Gemini again.`);
}

export async function getStartup(q: Queryable, slug: string): Promise<StartupRow | undefined> {
  const row = (await q.query<StartupRow>(`select ${COLS} from startups where slug = $1`, [slug])).rows[0];
  // The stored rubric is re-sanitised on read: whatever is in the database can never reach the scoring arithmetic unchecked.
  return row && { ...row, rubric: sanitizeRubric(row.rubric, defaultRubric(profileOf(row))) };
}

export async function listStartups(q: Queryable): Promise<(StartupRow & { scored: number; reach_out: number })[]> {
  const rows = (await q.query<StartupRow & { scored: number; reach_out: number }>(
    `select s.id, s.slug, s.name, s.pitch, s.sector, s.stage, s.geography, s.round_size, s.ask, s.rubric, s.rubric_source, s.rubric_note, s.created_at::text as created_at,
            (select count(*)::int from startup_scores x where x.startup_id = s.id) as scored,
            (select count(*)::int from startup_scores x where x.startup_id = s.id and x.action = 'reach_out_now') as reach_out
       from startups s order by s.created_at desc`,
  )).rows;
  return rows.map((r) => ({ ...r, rubric: sanitizeRubric(r.rubric, defaultRubric(profileOf(r))) }));
}

export async function getSteps(q: Queryable, id: string): Promise<StepRow[]> {
  const rows = (await q.query<StepRow>(`select step, status, detail, stats, started_at::text as started_at, finished_at::text as finished_at from startup_steps where startup_id = $1`, [id])).rows;
  return STEPS.map((s) => rows.find((r) => r.step === s) ?? { step: s, status: "pending" as const, detail: null, stats: {}, started_at: null, finished_at: null });
}

export async function saveRubric(q: Queryable, id: string, rubric: Rubric, source: "gemini" | "default" | "edited", note: string | null = null): Promise<void> {
  await q.query(`update startups set rubric = $2::jsonb, rubric_source = $3, rubric_note = $4, updated_at = now() where id = $1`, [id, JSON.stringify(rubric), source, note]);
  await setRubricStep(q, id, source, note);
}
