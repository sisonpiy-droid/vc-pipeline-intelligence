import { extractPortfolio, type PortfolioCompany } from "@/lib/ai/portfolio";
import type { Db, Queryable } from "@/lib/db";
import { fetchPortfolioPage } from "@/lib/providers/portfolioPage";
import type { Deps, CoverageEntry, InvestorRow } from "./research";

/**
 * The portfolio check for one investor: find its own portfolio page, have Gemini list the companies, validate in code,
 * and replace the stored list. It runs when the last good check is older than PORTFOLIO_MAX_AGE_DAYS (portfolios change
 * slowly), costs no search credits, and can never fail an investor: any problem is recorded as source coverage and the
 * previous list is kept.
 */
export const PORTFOLIO_MAX_AGE_DAYS = 30;
export const PORTFOLIO_SOURCE = "portfolio_page";

export type PortfolioResult =
  | { kind: "skip" } // an angel, or no website: there is no portfolio page to read
  | { kind: "stored"; coverage: CoverageEntry; url: string; companies: PortfolioCompany[]; ai_calls: number }
  | { kind: "unchanged"; coverage: CoverageEntry; ai_calls: number }; // nothing usable this time: keep what we had

export async function checkPortfolio(deps: Deps, inv: Pick<InvestorRow, "firm_name" | "entity_type" | "website_url">): Promise<PortfolioResult> {
  if (inv.entity_type === "angel" || !inv.website_url) return { kind: "skip" };
  const entry = (status: CoverageEntry["status"], count: number, category: string | null, note: string | null): CoverageEntry => ({ source: PORTFOLIO_SOURCE, status, result_count: count, error_category: category, note });

  const page = await fetchPortfolioPage(deps.pages, inv.website_url);
  if (page.status === "none") return { kind: "unchanged", coverage: entry("skipped", 0, null, page.note), ai_calls: 0 };
  if (page.status === "error") return { kind: "unchanged", coverage: entry("error", 0, page.error.category, page.error.message), ai_calls: 0 };

  const ex = await extractPortfolio(deps.ai, inv.firm_name, page.text);
  if (!ex.ok) return { kind: "unchanged", coverage: entry("error", 0, ex.category, ex.message), ai_calls: ex.ai_calls };
  if (!ex.is_list || ex.companies.length === 0)
    return { kind: "unchanged", coverage: entry("empty", 0, null, ex.is_list ? "the page lists no companies we could confirm" : "the page found is not a portfolio list"), ai_calls: ex.ai_calls };
  const logistics = ex.companies.filter((c) => c.logistics_related).length;
  return {
    kind: "stored", url: page.url, companies: ex.companies, ai_calls: ex.ai_calls,
    coverage: entry("ok", ex.companies.length, null, `${logistics} logistics-related${ex.dropped ? `; ${ex.dropped} unverifiable entr${ex.dropped === 1 ? "y" : "ies"} dropped` : ""}`),
  };
}

/** Is a (re)check due? Never checked, last attempt failed, or the last good check is old. */
export async function portfolioDue(q: Queryable, investorId: string, now: Date): Promise<boolean> {
  const r = (await q.query<{ status: string; age_days: number }>(
    `select status, extract(epoch from ($2::timestamptz - checked_at)) / 86400 as age_days from source_coverage where investor_id = $1 and source = $3`,
    [investorId, now.toISOString(), PORTFOLIO_SOURCE],
  )).rows[0];
  return !r || r.status === "error" || Number(r.age_days) > PORTFOLIO_MAX_AGE_DAYS;
}

/** Atomically replaces the stored list (or leaves it alone) and records coverage. */
export async function storePortfolio(rdb: Db, runId: string | null, investorId: string, res: Exclude<PortfolioResult, { kind: "skip" }>): Promise<void> {
  await rdb.tx(async (q) => {
    if (res.kind === "stored") {
      await q.query(`delete from portfolio_companies where investor_id = $1`, [investorId]);
      for (const c of res.companies)
        await q.query(
          `insert into portfolio_companies (investor_id, company, description, logistics_related, competitor_risk, evidence, source_url) values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (investor_id, company) do nothing`,
          [investorId, c.name, c.description, c.logistics_related, c.competitor_risk, c.evidence, res.url],
        );
    }
    const c = res.coverage;
    await q.query(
      `insert into source_coverage (investor_id, source, run_id, checked_at, status, result_count, error_category, note) values ($1,$2,$3,now(),$4,$5,$6,$7)
       on conflict (investor_id, source) do update set run_id = excluded.run_id, checked_at = now(), status = excluded.status,
          result_count = excluded.result_count, error_category = excluded.error_category, note = excluded.note`,
      [investorId, c.source, runId, c.status, c.result_count, c.error_category, c.note],
    );
    await q.query(`insert into audit_logs (run_id, investor_id, level, event, detail) values ($1, $2, $3, 'portfolio_checked', $4::jsonb)`, [runId, investorId, c.status === "error" ? "warn" : "info", JSON.stringify({ status: c.status, companies: c.result_count, note: c.note })]);
  });
}
