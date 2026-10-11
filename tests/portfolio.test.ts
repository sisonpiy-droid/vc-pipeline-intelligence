import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiError } from "@/lib/ai/gemini";
import { extractPortfolio } from "@/lib/ai/portfolio";
import type { Db } from "@/lib/db";
import { discoverPortfolioUrls, fetchPortfolioPage } from "@/lib/providers/portfolioPage";
import { ProviderError } from "@/lib/providers/types";
import { PORTFOLIO_MAX_AGE_DAYS, portfolioDue } from "@/lib/refresh/portfolio";
import { runChunk, startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";
import { NOW, article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

const HOME = `<html><body><nav><a href="/about">About</a><a href="/portfolio">Portfolio</a><a href="/team/jane-rao">Meet Jane, who led our logistics investments</a><a href="https://other.example/portfolio">Partner portfolio</a></nav></body></html>`;
const PORTFOLIO_TEXT =
  "Our portfolio. Fleetwise: a SaaS platform that lets shippers plan and track trucking routes across India. Dukaan Bazaar: online storefronts for neighbourhood shops. " +
  "Medlink: appointment booking for clinics. Hubstack: warehouse management software for 3PL operators and brands. " + "We back founders at the earliest stage. ".repeat(12);
const portfolioHtml = `<html><head><title>Portfolio | Alpha Ventures</title></head><body><main>${PORTFOLIO_TEXT}</main></body></html>`;

describe("discoverPortfolioUrls", () => {
  it("ranks the portfolio index first, stays on the same site, and ignores team pages and posts", () => {
    const urls = discoverPortfolioUrls(HOME, "https://alpha.vc/");
    expect(urls).toEqual(["https://alpha.vc/portfolio"]);
  });
});

describe("fetchPortfolioPage", () => {
  const site = "https://alpha.vc";
  it("finds the page from the homepage link", async () => {
    const r = await fetchPortfolioPage(fakePages({ [`${site}/`]: HOME, [`${site}/portfolio`]: portfolioHtml }), site);
    expect(r).toMatchObject({ status: "found", url: `${site}/portfolio` });
  });
  it("falls back to conventional paths when the homepage is unreachable", async () => {
    const r = await fetchPortfolioPage(fakePages({ [`${site}/companies`]: portfolioHtml.replace("Portfolio |", "Companies |") }), site);
    expect(r).toMatchObject({ status: "found", url: `${site}/companies` });
  });
  it("says so when the page is a logo grid with no text, and when there is no page at all", async () => {
    const grid = `<html><head><title>Portfolio</title></head><body><main><img alt="a"><img alt="b"></main></body></html>`;
    expect(await fetchPortfolioPage(fakePages({ [`${site}/portfolio`]: grid }), site)).toMatchObject({ status: "none", note: expect.stringMatching(/almost no readable text/) });
    expect(await fetchPortfolioPage(fakePages({}), site)).toMatchObject({ status: "none", note: expect.stringMatching(/no portfolio page found/) });
  });
  it("a server error is reported, not mistaken for 'no portfolio'", async () => {
    const r = await fetchPortfolioPage(fakePages({ [`${site}/portfolio`]: new ProviderError("http_5xx", "origin down") }), site);
    expect(r).toMatchObject({ status: "error" });
  });
  it("a team page that a 'Portfolio' link lands on is not accepted as a portfolio index", async () => {
    const team = `<html><head><title>Jane Rao | Team</title></head><body><main>${"Jane leads logistics investments. ".repeat(30)}</main></body></html>`;
    const home = `<html><body><a href="/team/jane">Portfolio lead</a></body></html>`;
    expect((await fetchPortfolioPage(fakePages({ [`${site}/`]: home, [`${site}/team/jane`]: team }), site)).status).not.toBe("found");
  });
});

describe("extractPortfolio: the model's list is checked against the page", () => {
  const reply = (companies: object[], is_portfolio_list = true) => ({ generateJson: async () => ({ is_portfolio_list, companies }) });
  const c = (name: string, o: Partial<{ description: string; logistics_related: boolean; competitor_risk: string; evidence: string }> = {}) => ({ name, description: "", logistics_related: false, competitor_risk: "none", evidence: "", ...o });

  it("keeps a logistics claim only when its quote is on the page; otherwise the company stays, unflagged", async () => {
    const r = await extractPortfolio(reply([
      c("Fleetwise", { logistics_related: true, competitor_risk: "direct", evidence: "a SaaS platform that lets shippers plan and track trucking routes across India" }),
      c("Hubstack", { logistics_related: true, competitor_risk: "direct", evidence: "warehouse robots for fulfilment centres" }), // quote is NOT on the page
      c("Medlink"),
    ]), "Alpha", PORTFOLIO_TEXT);
    expect(r.ok && r.companies.map((x) => [x.name, x.logistics_related, x.competitor_risk])).toEqual([["Fleetwise", true, "direct"], ["Hubstack", false, "none"], ["Medlink", false, "none"]]);
  });

  it("drops companies that are not on the page at all (the model's own knowledge is not evidence) and repeats", async () => {
    const r = await extractPortfolio(reply([c("Delhivery", { logistics_related: true, competitor_risk: "adjacent", evidence: "Delhivery is a logistics company" }), c("Medlink"), c("medlink")]), "Alpha", PORTFOLIO_TEXT);
    expect(r).toMatchObject({ ok: true, dropped: 2 });
    expect(r.ok && r.companies.map((x) => x.name)).toEqual(["Medlink"]);
  });

  it("a page that is not a portfolio list yields no companies", async () => {
    expect(await extractPortfolio(reply([c("Medlink")], false), "Alpha", PORTFOLIO_TEXT)).toMatchObject({ ok: true, is_list: false, companies: [] });
  });

  it("invalid output is retried once then reported; an outage is typed", async () => {
    let n = 0;
    expect(await extractPortfolio({ generateJson: async () => { n++; return { nope: 1 }; } }, "A", PORTFOLIO_TEXT)).toMatchObject({ ok: false, category: "invalid_output" });
    expect(n).toBe(2);
    expect(await extractPortfolio({ generateJson: async () => { throw new AiError("rate_limited", "429"); } }, "A", PORTFOLIO_TEXT)).toMatchObject({ ok: false, category: "rate_limited" });
  });
});

describe("the portfolio check inside a refresh", () => {
  let db: Db;
  let rdb: Db;
  const u = "https://news.example/alpha";
  const good = () => ({
    is_portfolio_list: true,
    companies: [{ name: "Fleetwise", description: "route planning SaaS", logistics_related: true, competitor_risk: "direct", evidence: "a SaaS platform that lets shippers plan and track trucking routes across India" }, { name: "Medlink", description: "", logistics_related: false, competitor_risk: "none", evidence: "" }],
  });
  const world = (portfolio: ReturnType<typeof fakeAi>, pages: Record<string, string | ProviderError> = { "https://alpha.vc/": HOME, "https://alpha.vc/portfolio": portfolioHtml }) =>
    ({ ...mkDeps(fakeSearch({ Alpha: [hit(u, "Alpha", daysAgo(2))], Beta: [] }), fakePages({ [u]: article("Alpha", daysAgo(2)), ...pages }), portfolio), portfolio: true });

  beforeAll(async () => { db = await makeTestDb(); rdb = asRefresh(db); });
  afterAll(() => db.close());
  beforeEach(async () => {
    await db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs, score_history, portfolio_companies restart identity cascade");
    await db.query(`insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography) values ('vc_firm', 'alpha', 'Alpha', 'https://alpha.vc', 'Seed', '{Logistics}', 'India'), ('angel', 'beta', 'Beta', 'https://beta.example', 'Seed', '{Logistics}', 'India')`);
  });
  const run = async (deps: ReturnType<typeof world>) => { const { run_id } = await startRun(rdb, "manual"); await runChunk(rdb, deps, run_id, { batchEstimateMs: 0 }); return run_id; };
  const list = async () => (await db.query(`select company, logistics_related l, competitor_risk r from portfolio_companies order by company`)).rows;
  const cov = async (name = "Alpha") => (await db.query(`select status, result_count n, note, error_category c from source_coverage sc join investors i on i.id = sc.investor_id where i.firm_name = $1 and source = 'portfolio_page'`, [name])).rows[0] as { status: string; n: number; note: string | null; c: string | null } | undefined;

  it("stores the verified list, records coverage, and never checks an angel", async () => {
    await run(world(fakeAi({}, "ok", undefined, undefined, good)));
    expect(await list()).toEqual([{ company: "Fleetwise", l: true, r: "direct" }, { company: "Medlink", l: false, r: "none" }]);
    expect(await cov()).toMatchObject({ status: "ok", n: 2, note: expect.stringMatching(/1 logistics-related/) });
    expect(await cov("Beta")).toBeUndefined();
  });

  it("is off unless enabled, so it costs nothing by default", async () => {
    const deps = world(fakeAi({}, "ok", undefined, undefined, good));
    await run({ ...deps, portfolio: false });
    expect(await list()).toEqual([]);
    expect(await cov()).toBeUndefined();
  });

  it("is not repeated within 30 days, and is due again after that or after a failure", async () => {
    const ai = fakeAi({}, "ok", undefined, undefined, good);
    await run(world(ai));
    const id = ((await db.query(`select id from investors where firm_name = 'Alpha'`)).rows[0] as { id: string }).id;
    expect(await portfolioDue(rdb, id, NOW)).toBe(false);
    expect(await portfolioDue(rdb, id, new Date(NOW.getTime() + (PORTFOLIO_MAX_AGE_DAYS + 1) * 86_400_000))).toBe(true);
    await db.query(`update source_coverage set status = 'error' where source = 'portfolio_page'`);
    expect(await portfolioDue(rdb, id, NOW)).toBe(true);
  });

  it("a Gemini outage or an unreadable page keeps the previous list and records why; the investor still finishes", async () => {
    await run(world(fakeAi({}, "ok", undefined, undefined, good)));
    await db.query(`update source_coverage set checked_at = now() - interval '40 days' where source = 'portfolio_page'`);
    const id = await run(world(fakeAi({}, "ok", undefined, undefined, new AiError("unavailable", "down"))));
    expect(await list()).toHaveLength(2); // kept
    expect(await cov()).toMatchObject({ status: "error", c: "unavailable" });
    expect(((await db.query(`select status from run_items where run_id = $1 and investor_id = (select id from investors where firm_name = 'Alpha')`, [id])).rows[0] as { status: string }).status).toBe("done");
  });

  it("no portfolio page is recorded as 'skipped', not as an error", async () => {
    await run(world(fakeAi({}, "ok", undefined, undefined, good), {}));
    expect(await cov()).toMatchObject({ status: "skipped", note: expect.stringMatching(/no portfolio page/) });
  });

  it("never affects the score or the founder-owned columns", async () => {
    await db.query(`update investors set personal_notes = 'PRIVATE', relationship_status = 'contacted' where firm_name = 'Alpha'`);
    const before = (await db.query(`select personal_notes, relationship_status from investors where firm_name = 'Alpha'`)).rows[0];
    await run({ ...world(fakeAi({}, "ok", undefined, undefined, good)), portfolio: false });
    const scoreWithout = ((await db.query(`select follow_up_score s from investors where firm_name = 'Alpha'`)).rows[0] as { s: number }).s;
    await db.exec("truncate runs, run_items, signals, source_coverage, audit_logs, score_history restart identity cascade");
    await run(world(fakeAi({}, "ok", undefined, undefined, good)));
    expect(((await db.query(`select follow_up_score s from investors where firm_name = 'Alpha'`)).rows[0] as { s: number }).s).toBe(scoreWithout);
    expect((await db.query(`select personal_notes, relationship_status from investors where firm_name = 'Alpha'`)).rows[0]).toEqual(before);
  });
});

import { looksLikeTagline } from "@/lib/ai/portfolio";
describe("taglines are not companies", () => {
  it("rejects descriptions the page prints in place of a name, keeps real brand names", () => {
    for (const t of ["Dark stores for same day deliveries", "India’s largest cold supply chain network", "Drone logistics for enterprises", "AI powered Port Logistics".replace("AI powered", "Logistics solutions for ports")]) expect(looksLikeTagline(t), t).toBe(true);
    for (const n of ["Zypp", "Shiprocket", "Battery Smart", "Delhivery", "Fleetwise", "Dukaan Bazaar", "Next Generation EV"]) expect(looksLikeTagline(n), n).toBe(false);
  });
});
