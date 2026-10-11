import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { discoverFeedUrls, fetchOfficialFeed, parseFeed } from "@/lib/providers/feeds";
import { ProviderError } from "@/lib/providers/types";
import { runChunk, startRun } from "@/lib/refresh/run";
import { asRefresh } from "@/lib/refresh/write";
import { EXCERPT, NOW, article, daysAgo, fakeAi, fakePages, fakeSearch, hit, mkDeps } from "./helpers/fakes";
import { makeTestDb } from "./helpers/testDb";

const rfc = (d: string) => new Date(`${d}T09:00:00Z`).toUTCString();
const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title>${items}</channel></rss>`;
const item = (title: string, link: string, date: string | null, desc = "A short description of the announcement that is long enough.") =>
  `<item><title>${title}</title><link>${link}</link>${date ? `<pubDate>${rfc(date)}</pubDate>` : ""}<description><![CDATA[<p>${desc}</p>]]></description></item>`;
const WIN = ["2026-09-11", "2026-10-11"] as const;

describe("parseFeed", () => {
  it("reads RSS items, unwraps CDATA, strips markup and decodes entities", () => {
    const items = parseFeed(rss(item("Fund V &amp; our thesis", "https://x.vc/p/1", "2026-10-05", "We closed <b>Fund V</b> &ndash; $100M.")));
    expect(items).toEqual([{ url: "https://x.vc/p/1", title: "Fund V & our thesis", summary: "We closed Fund V – $100M.", published: rfc("2026-10-05") }]);
  });

  it("reads Atom entries using the alternate link and published/updated dates", () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Backing Raaho</title>
      <link rel="self" href="https://x.vc/feed/1"/><link rel="alternate" href="https://x.vc/p/raaho"/>
      <published>2026-10-03T08:00:00Z</published><summary>Seed round in logistics.</summary></entry></feed>`;
    expect(parseFeed(atom)).toMatchObject([{ url: "https://x.vc/p/raaho", title: "Backing Raaho", published: "2026-10-03T08:00:00Z" }]);
  });

  it("skips items without a real http(s) URL or a title, and survives garbage", () => {
    expect(parseFeed(rss(`<item><title>No link</title></item><item><link>https://x.vc/a</link></item><item><title>JS</title><link>javascript:alert(1)</link></item>`))).toEqual([]);
    for (const junk of ["", "not xml", "<item><title>unclosed", "<<<>>>"]) expect(() => parseFeed(junk)).not.toThrow();
    expect(parseFeed("<item><title>unclosed")).toEqual([]);
  });

  it("caps the work on huge feeds", () => {
    const many = Array.from({ length: 200 }, (_, i) => item(`Post ${i}`, `https://x.vc/p/${i}`, "2026-10-05")).join("");
    expect(parseFeed(rss(many)).length).toBeLessThanOrEqual(30);
  });
});

describe("discoverFeedUrls", () => {
  it("finds advertised RSS/Atom feeds, resolves relative links, ignores other alternates", () => {
    const html = `<head><link rel="alternate" type="application/rss+xml" href="/blog/index.xml">
      <link rel="alternate" type="application/atom+xml" href="https://x.vc/atom">
      <link rel="alternate" hreflang="fr" href="/fr"><link rel="stylesheet" href="/a.css"></head>`;
    expect(discoverFeedUrls(html, "https://x.vc/")).toEqual(["https://x.vc/blog/index.xml", "https://x.vc/atom"]);
  });
});

describe("fetchOfficialFeed", () => {
  const home = (link = "") => `<html><head>${link}</head><body>hi</body></html>`;

  it("uses the feed the homepage advertises, and returns only newest in-window items (undated items are never assumed recent)", async () => {
    const pages = fakePages({
      "https://x.vc/": home(`<link rel="alternate" type="application/rss+xml" href="/blog/rss">`),
      "https://x.vc/blog/rss": rss(item("New", "https://x.vc/p/new", "2026-10-08") + item("Older", "https://x.vc/p/older", "2026-09-20") + item("Ancient", "https://x.vc/p/old", "2026-05-01") + item("Undated", "https://x.vc/p/u", null)),
    });
    const r = await fetchOfficialFeed(pages, "https://x.vc", ...WIN);
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.inWindow.map((i) => i.title)).toEqual(["New", "Older"]);
  });

  it("falls back to conventional paths, and keeps at most 5 items", async () => {
    const many = Array.from({ length: 9 }, (_, i) => item(`P${i}`, `https://x.vc/p/${i}`, `2026-10-0${i + 1}`)).join("");
    const pages = fakePages({ "https://x.vc/": home(), "https://x.vc/feed.xml": rss(many) });
    const r = await fetchOfficialFeed(pages, "https://x.vc", ...WIN);
    expect(r.status === "found" && r.inWindow.map((i) => i.title)).toEqual(["P8", "P7", "P6", "P5", "P4"]);
  });

  it("no feed anywhere is 'none' (normal), not an error", async () => {
    const r = await fetchOfficialFeed(fakePages({ "https://x.vc/": home() }), "https://x.vc", ...WIN);
    expect(r).toMatchObject({ status: "none" });
  });

  it("a feed that errors (5xx) is reported as an error with its category; a bad website is 'none'", async () => {
    const pages = fakePages({ "https://x.vc/": home(`<link rel="alternate" type="application/rss+xml" href="/f">`), "https://x.vc/f": new ProviderError("http_5xx", "origin down") });
    const r = await fetchOfficialFeed(pages, "https://x.vc", ...WIN);
    expect(r.status === "error" && r.error.category).toBe("http_5xx");
    expect((await fetchOfficialFeed(fakePages({}), "not a url", ...WIN)).status).toBe("none");
  });

  it("an unreachable homepage does not stop the conventional paths from being tried", async () => {
    const pages = fakePages({ "https://x.vc/": new ProviderError("timeout", "slow"), "https://x.vc/feed": rss(item("Hi", "https://x.vc/p/1", "2026-10-09")) });
    expect((await fetchOfficialFeed(pages, "https://x.vc", ...WIN)).status).toBe("found");
  });
});

describe("official feeds through the pipeline", () => {
  let db: Db;
  let rdb: Db;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    db = await makeTestDb();
    rdb = asRefresh(db);
  });
  afterAll(() => db.close());
  beforeEach(async () => {
    await db.exec("truncate investors, runs, run_items, signals, source_coverage, audit_logs restart identity cascade");
    for (const n of ["Alpha", "Beta"])
      ids[n] = (await db.query<{ id: string }>(
        `insert into investors (entity_type, name_key, firm_name, website_url, stage_preference, sectors, geography) values ('vc_firm', $1, $2, $3, 'Seed', '{Logistics}', 'India') returning id`,
        [n.toLowerCase(), n, `https://${n.toLowerCase()}.vc`],
      )).rows[0]!.id;
  });

  const run = async (pages: ReturnType<typeof fakePages>, search = fakeSearch({ Alpha: [], Beta: [] }), ai = fakeAi()) => {
    const { run_id } = await startRun(rdb, "manual");
    await runChunk(rdb, { ...mkDeps(search, pages, ai), officialFeeds: true }, run_id, { batchEstimateMs: 0 });
    return { run_id, ai };
  };
  const post = "https://alpha.vc/blog/seed-round";

  it("an official post becomes a verified, official-source signal with NO search results and NO search credits for it", async () => {
    const pages = fakePages({
      "https://alpha.vc/": `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>`,
      "https://alpha.vc/feed.xml": rss(item("We led a seed round", post, daysAgo(3), "We led a seed round in a freight marketplace for trucking fleets across India.")),
      [post]: article("Alpha", daysAgo(3)),
    });
    const { ai } = await run(pages);
    const s = (await db.query(`select date_source, source_name, verification_status, published_at::text d from signals where investor_id=$1`, [ids.Alpha])).rows[0];
    expect(s).toEqual({ date_source: "feed", source_name: "alpha.vc", verification_status: "verified", d: daysAgo(3) });
    expect(ai.prompts[0]).toContain('official="true"'); // the model is told this is the investor's own post
    expect((await db.query(`select status, result_count from source_coverage where investor_id=$1 and source='official_feed'`, [ids.Alpha])).rows[0]).toEqual({ status: "ok", result_count: 1 });
  });

  it("the same story found by search and by the feed is one signal (the official copy wins)", async () => {
    const pages = fakePages({
      "https://alpha.vc/": `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>`,
      "https://alpha.vc/feed.xml": rss(item("Alpha backs logistics startup", post, daysAgo(3))),
      [post]: article("Alpha", daysAgo(3)),
      "https://news.example/same": article("Alpha", daysAgo(3)),
    });
    await run(pages, fakeSearch({ Alpha: [hit("https://news.example/same", "Alpha", daysAgo(3))], Beta: [] }));
    const rows = (await db.query(`select canonical_url, verification_status s, rejection_reason r from signals where investor_id=$1 order by canonical_url`, [ids.Alpha])).rows;
    expect(rows.filter((r) => r.s === "verified")).toHaveLength(1);
    expect(rows.find((r) => r.s === "verified")!.canonical_url).toContain("alpha.vc");
    expect(rows.find((r) => r.r === "duplicate_event")).toBeTruthy();
  });

  it("no feed is 'skipped' and a broken feed is an 'error' — neither makes the investor 'partial'", async () => {
    await run(fakePages({ "https://alpha.vc/": "<html></html>", "https://beta.vc/": `<html><head><link rel="alternate" type="application/rss+xml" href="/f"></head></html>`, "https://beta.vc/f": new ProviderError("http_5xx", "down") }));
    const cov = (n: string) => db.query(`select status, error_category from source_coverage where investor_id=$1 and source='official_feed'`, [ids[n]]).then((r) => r.rows[0]);
    expect(await cov("Alpha")).toEqual({ status: "skipped", error_category: null });
    expect(await cov("Beta")).toEqual({ status: "error", error_category: "http_5xx" });
    const partial = (await db.query(`select count(*)::int n from run_items where outcome->>'coverage' = 'partial'`)).rows[0] as { n: number };
    expect(partial.n).toBe(0);
  });

  it("feeds are off unless enabled, and an item whose page contradicts the feed date is rejected", async () => {
    const pages = fakePages({
      "https://alpha.vc/": `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>`,
      "https://alpha.vc/feed.xml": rss(item("Old story re-dated", post, daysAgo(2))),
      [post]: article("Alpha", daysAgo(40)).replace("</head>", `<meta name="date" content="${daysAgo(40)}"></head>`),
    });
    await run(pages);
    expect((await db.query(`select rejection_reason from signals where investor_id=$1`, [ids.Alpha])).rows).toEqual([{ rejection_reason: "contradictory_dates" }]);

    const off = fakePages({ "https://alpha.vc/": "<html></html>" });
    const { run_id } = await startRun(rdb, "manual");
    await runChunk(rdb, mkDeps(fakeSearch({ Alpha: [], Beta: [] }), off, fakeAi()), run_id, { batchEstimateMs: 0 });
    expect(off.fetched).toEqual([]);
  });
});

void EXCERPT;
void NOW;
