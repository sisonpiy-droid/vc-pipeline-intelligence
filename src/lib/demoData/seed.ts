import type { Db } from "@/lib/db";
import { rescoreAll, scoreAndWrite, loadInvestor } from "@/lib/refresh/rescore";
import { asRefresh } from "@/lib/refresh/write";

/**
 * Demo data: five clearly labelled, entirely synthetic investors, one per situation the product has to handle. Nothing here is
 * real intelligence and nothing here is fetched: signals are written directly, then scored by the REAL scoring engine through the
 * same restricted refresh role a real refresh uses, so the demo exercises the genuine rules, the four-column write boundary and the
 * audit trail without a single search credit or model call.
 *
 * Safety: every row is flagged `is_demo`. Reset deletes only flagged rows, and every real-data path (planner, re-score, live
 * dashboards) excludes them.
 */
export const DEMO_EMAIL = "sisonpiy@gmail.com";
export const DEMO_TEXT = "This is a demo account.";

type Sector = "logistics" | "b2b_software" | "seed_generalist" | "adjacent" | "unrelated";

interface DemoSignal {
  slug: string;
  headline: string;
  host: string;
  daysAgo: number;
  type: "portfolio_investment" | "article" | "interview_podcast" | "public_statement" | "event_appearance" | "fund_thesis_announcement" | "other";
  excerpt: string;
  summary: string;
  why: string;
  relevance: number;
  confidence: "high" | "medium" | "low";
  sector: Sector | null; // null = the second-pass review has not run
  dateSource: "page" | "feed" | "search_estimate";
  status?: "verified" | "needs_review" | "rejected";
  reason?: string;
  duplicateOf?: string; // slug of the signal this repeats
}

interface DemoSpec {
  key: string;
  /** The investor profile the fit score reads: they deliberately differ, so the demo shows high fit and very low fit side by side. */
  profile: { sectors: string[]; stage: string; geography: string };
  criterion: string;
  name: string;
  signals: DemoSignal[];
  angle?: string;
}

const REAL_WORLD_NOTE = "Synthetic: no real page exists behind this link.";
const sig = (s: Omit<DemoSignal, "excerpt" | "summary" | "why"> & Partial<Pick<DemoSignal, "excerpt" | "summary" | "why">>): DemoSignal => ({
  excerpt: `${DEMO_TEXT} ${s.headline}.`,
  summary: `${DEMO_TEXT} ${s.headline}.`,
  why: `${DEMO_TEXT} ${REAL_WORLD_NOTE}`,
  ...s,
});

export const DEMO_SPECS: DemoSpec[] = [
  {
    key: "high", profile: { sectors: ["Logistics", "B2B SaaS"], stage: "Seed", geography: "India" }, criterion: "High priority", name: "Piyush: High priority (demo)",
    signals: [sig({ slug: "freight-seed", headline: "Piyush leads a seed round in a freight-marketplace startup", host: "demo.example", daysAgo: 2, type: "portfolio_investment", relevance: 90, confidence: "high", sector: "logistics", dateSource: "page", why: `${DEMO_TEXT} A fresh, on-topic seed investment: the clearest kind of reason to reach out.` })],
    angle: `${DEMO_TEXT} I saw that Piyush led a seed round in a freight-marketplace startup. I am raising a Seed round for a B2B logistics SaaS and would value your view on what we are building.`,
  },
  {
    key: "low", profile: { sectors: ["Fintech", "Payments"], stage: "Series A", geography: "India" }, criterion: "Low priority", name: "Piyush: Low priority (demo)",
    signals: [sig({ slug: "fintech-seed", headline: "Piyush backs a consumer-payments startup", host: "demo-news.example", daysAgo: 14, type: "portfolio_investment", relevance: 55, confidence: "medium", sector: "adjacent", dateSource: "page", why: `${DEMO_TEXT} A real investment, but in another sector, so relevance is capped and no outreach is recommended.` })],
  },
  {
    key: "stale", profile: { sectors: ["Supply chain", "Freight"], stage: "Seed", geography: "India" }, criterion: "Stale signal", name: "Piyush: Stale signal (demo)",
    signals: [sig({ slug: "old-logistics", headline: "Piyush speaks about supply-chain software", host: "demo-events.example", daysAgo: 45, type: "event_appearance", relevance: 85, confidence: "high", sector: "logistics", dateSource: "page", why: `${DEMO_TEXT} On topic, but 45 days old: outside the 30-day window, so it earns no score.` })],
  },
  {
    key: "unverified", profile: { sectors: ["Consumer fashion", "Gaming"], stage: "Late stage / pre-IPO", geography: "United States" }, criterion: "Unverified signal", name: "Piyush: Unverified signal (demo)",
    signals: [
      sig({ slug: "blog-claim", headline: "Piyush reportedly considering logistics deals", host: "demo-blog.example", daysAgo: 4, type: "public_statement", relevance: 45, confidence: "low", sector: null, dateSource: "search_estimate", why: `${DEMO_TEXT} Looks mildly relevant, but the date is a search estimate and the second-pass check has not confirmed it.` }),
      sig({ slug: "unreadable-page", headline: "Piyush interview (page could not be read)", host: "demo-media.example", daysAgo: 3, type: "interview_podcast", relevance: 70, confidence: "low", sector: null, dateSource: "search_estimate", status: "needs_review", reason: "page_unavailable" }),
    ],
  },
  {
    key: "irrelevant", profile: { sectors: ["Gaming", "Media"], stage: "Early stage", geography: "India" }, criterion: "Irrelevant signal", name: "Piyush: Irrelevant signal (demo)",
    signals: [sig({ slug: "game-studio", headline: "Piyush invests in a mobile-game studio", host: "demo-games.example", daysAgo: 5, type: "portfolio_investment", relevance: 80, confidence: "high", sector: "unrelated", dateSource: "page", why: `${DEMO_TEXT} A real, well-sourced investment, but nothing to do with logistics, so it earns nothing.` })],
  },
];

const iso = (now: Date, daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);

export interface DemoResult {
  removed: number;
  created: number;
}

/** Deletes ONLY demo rows (and the audit lines they produced), then recreates the demo investors. */
export async function resetDemo(db: Db, now = new Date()): Promise<DemoResult> {
  const ids: string[] = [];
  const removed = await db.tx(async (q) => {
    await q.query(
      `delete from audit_logs where investor_id in (select id from investors where is_demo)
          or run_id in (select id from runs where is_demo) or left(event, 5) = 'demo_'`,
    );
    await q.query(`delete from runs where is_demo`); // run_items cascade
    return (await q.query(`delete from investors where is_demo`)).rowCount; // signals, coverage, score_history cascade
  });

  const rdb = asRefresh(db);
  const runId = (await db.query<{ id: string }>(
    `insert into runs (trigger_type, status, started_at, heartbeat_at, completed_at, investors_total, investors_processed, signals_discovered,
                       signals_accepted, duplicates_removed, records_updated, summary, plan, is_demo)
     values ('manual', 'succeeded', $1, $1, $1, $2, $2, 7, 5, 1, $2, $3, '{"simulated": true}'::jsonb, true) returning id`,
    [new Date(now.getTime() - 60_000).toISOString(), DEMO_SPECS.length, `Simulated run on demo data (${DEMO_TEXT.toLowerCase()} No real searches or AI calls were made.)`],
  )).rows[0]!.id;

  for (const spec of DEMO_SPECS) {
    const inv = (await db.query<{ id: string }>(
      `insert into investors (entity_type, name_key, firm_name, role_title, website_url, investment_thesis, thesis_verified, fit_rationale, sectors, stage_preference, geography,
                              verification_status, verification_note, data_flags, personal_notes, contact_email, is_demo)
       values ('angel', $1, $2, $3, $4, null, false, $5, $8::text[], $9, $10, 'unverified', $5, '{demo_account}', $6, $7, true) returning id`,
      [`demo-${spec.key}`, spec.name, `${spec.criterion}. ${DEMO_TEXT}`, `https://demo.example/piyush-${spec.key}`, `${DEMO_TEXT} Synthetic profile for testing: not a real investor.`, `${DEMO_TEXT} Notes you add here stay on this demo record.`, DEMO_EMAIL, spec.profile.sectors, spec.profile.stage, spec.profile.geography],
    )).rows[0]!.id;
    ids.push(inv);

    const idBySlug = new Map<string, string>();
    for (const s of spec.signals) {
      const status = s.status ?? "verified";
      const url = `https://${s.host}/piyush-${spec.key}/${s.slug}`;
      const row = (await db.query<{ id: string }>(
        `insert into signals (investor_id, run_id, url, canonical_url, headline, source_name, published_at, date_basis, date_source, signal_type, evidence_excerpt, summary,
                              relevance_explanation, relevance_score, evidence_confidence, verification_status, rejection_reason, sector_match, firm_acting, reviewed_at)
         values ($1,$2,$3,$3,$4,$5,$6,'published',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
        [inv, runId, url, s.headline, s.host, iso(now, s.daysAgo), s.dateSource, status === "verified" ? s.type : null, status === "verified" ? s.excerpt : null, status === "verified" ? s.summary : null,
          status === "verified" ? s.why : null, status === "verified" ? s.relevance : null, status === "verified" ? s.confidence : null, status, s.reason ?? null,
          status === "verified" ? s.sector : null, status === "verified" && s.sector ? true : null, status === "verified" && s.sector ? now.toISOString() : null],
      )).rows[0]!.id;
      idBySlug.set(s.slug, row);
      if (s.duplicateOf) await db.query(`update signals set duplicate_of = $2 where id = $1`, [row, idBySlug.get(s.duplicateOf)]);
    }
    await db.query(
      `insert into source_coverage (investor_id, source, run_id, status, result_count, note) values ($1, 'synthetic_demo', $2, 'ok', $3, $4)`,
      [inv, runId, spec.signals.length, `${DEMO_TEXT} Synthetic data: no real search was made.`],
    );
    await db.query(`insert into run_items (run_id, investor_id, status, attempts, started_at, finished_at) values ($1, $2, 'done', 1, now(), now())`, [runId, inv]);

    // Score with the real engine, as the restricted refresh role, exactly like a refresh would.
    const result = await rdb.tx(async (q) => {
      const row = (await loadInvestor(q, inv))!;
      return scoreAndWrite(q, row, { now, partial: false, runId, source: "refresh" });
    });
    const r = result.result;
    if (spec.angle && r.action === "reach_out_now") await db.query(`update score_history set angle = $2 where id = $1`, [result.historyId, spec.angle]);
    await db.query(
      `update run_items set outcome = $3::jsonb where run_id = $1 and investor_id = $2`,
      [runId, inv, JSON.stringify({ score: r.score, action: r.action, explanation: r.explanation, breakdown: r.breakdown, capped_by: r.capped_by, lead_signal_id: r.lead_signal?.id ?? null, relevant_signals: r.relevant_signal_count, coverage: "complete", simulated: true })],
    );
  }
  await db.query(`insert into audit_logs (run_id, event, detail) values ($1, 'demo_reset', $2::jsonb)`, [runId, JSON.stringify({ removed, created: ids.length, simulated: true })]);
  return { removed, created: ids.length };
}

export interface SimulatedRun {
  run_id: string;
  investors: number;
  changed: number;
  action_changes: number;
}

/** A simulated refresh: re-scores the demo investors from their stored synthetic evidence. No search, no model, no credits. */
export async function simulateRun(db: Db, now = new Date()): Promise<SimulatedRun> {
  const rdb = asRefresh(db);
  const run = (await db.query<{ id: string }>(
    `insert into runs (trigger_type, status, completed_at, investors_total, investors_processed, summary, plan, is_demo)
     values ('manual', 'succeeded', now(), 0, 0, 'Simulated refresh on demo data: re-scored from stored synthetic evidence. No real searches or AI calls were made.', '{"simulated": true}'::jsonb, true) returning id`,
  )).rows[0]!;
  const sum = await rescoreAll(rdb, now, { demo: true, runId: run.id });
  await db.query(`update runs set investors_total = $2, investors_processed = $2, records_updated = $3 where id = $1`, [run.id, sum.investors, sum.changed]);
  await db.query(`insert into audit_logs (run_id, event, detail) values ($1, 'demo_simulated_run', $2::jsonb)`, [run.id, JSON.stringify({ ...sum, simulated: true })]);
  return { run_id: run.id, investors: sum.investors, changed: sum.changed, action_changes: sum.action_changes };
}

export async function demoExists(db: Db): Promise<boolean> {
  return (await db.query(`select 1 from investors where is_demo limit 1`)).rowCount > 0;
}
