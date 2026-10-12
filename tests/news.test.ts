import { describe, expect, it } from "vitest";
import { fetchNews, mergeNews, NEWS_SOURCES, toNews } from "@/lib/news";
import { parseFeed } from "@/lib/providers/feeds";

const NOW = new Date("2026-10-12T08:00:00Z");
const src = NEWS_SOURCES[0]!;
const item = (title: string, summary: string, published: string | null, url = `https://x.example/${title.length}-${summary.length}`) => ({ url, title, summary, published });

describe("toNews: only recent venture-capital stories", () => {
  it("keeps a VC story, drops an off-topic one, an old one and an undated one", () => {
    const out = toNews([
      item("Logistics startup raises $4M seed round", "Backed by an Indian VC fund.", "Sun, 11 Oct 2026 10:00:00 GMT"),
      item("Best pasta recipes", "Nothing about money.", "Sun, 11 Oct 2026 10:00:00 GMT"),
      item("Fund closes $200M", "An old story about a fund.", "Mon, 01 Jun 2026 10:00:00 GMT"),
      item("Seed round announced", "Undated, so never assumed recent.", null),
    ], src, NOW);
    expect(out.map((n) => n.title)).toEqual(["Logistics startup raises $4M seed round"]);
    expect(out[0]).toMatchObject({ published: "2026-10-11", source: "TechCrunch", region: "Global" });
  });

  it("a listing story is public markets, not venture capital, unless the headline is about a round or VC", () => {
    const stamp = "Sun, 11 Oct 2026 10:00:00 GMT";
    expect(toNews([item("Tonbo Imaging sets IPO price band", "The IPO offers an investor exit and funds for the company.", stamp)], src, NOW)).toEqual([]);
    expect(toNews([item("Ecomm sales soar as VC funding drops", "Venture funding slowed in the festive quarter.", stamp)], src, NOW)).toHaveLength(1);
    expect(toNews([item("Startup raises seed round ahead of IPO plans", "Seed funding of 3 million dollars.", stamp)], src, NOW)).toHaveLength(1);
  });

  it("a word like 'startup' alone is not venture capital", () => {
    expect(toNews([item("Startup launches a new app", "It helps with recipes.", "Sun, 11 Oct 2026 10:00:00 GMT")], src, NOW)).toEqual([]);
  });

  it("cuts a snippet at a sentence, keeps the longer excerpt bounded, and strips the publisher's footer", () => {
    const long = "A fund closed its latest vehicle. " + "It will write cheques across sectors. ".repeat(60) + "The post Fund closes appeared first on TechCrunch.";
    const [n] = toNews([item("Fund closes new vehicle", long, "Sun, 11 Oct 2026 10:00:00 GMT")], src, NOW);
    expect(n!.snippet.length).toBeLessThanOrEqual(171);
    expect(n!.snippet.endsWith(".")).toBe(true);
    expect(n!.text.length).toBeLessThanOrEqual(1401);
    expect(n!.text).not.toContain("appeared first on");
  });

  it("parses a real RSS item end to end", () => {
    const xml = `<rss><channel><item><title>Seed round for a freight startup</title><link>https://a.example/s</link><pubDate>Sun, 11 Oct 2026 09:00:00 GMT</pubDate><description><![CDATA[<p>Investors &amp; funds back it.</p>]]></description></item></channel></rss>`;
    expect(toNews(parseFeed(xml), src, NOW)[0]).toMatchObject({ title: "Seed round for a freight startup", text: "Investors & funds back it." });
  });
});

describe("mergeNews", () => {
  const n = (title: string, published: string, url: string) => ({ id: url, title, url, source: "S", sourceId: "s", region: "Global", published, snippet: "", text: "" });
  it("sorts newest first and removes the same story reported by two feeds", () => {
    const out = mergeNews([n("Fund closes", "2026-10-10", "https://a/1"), n("Fund closes!", "2026-10-11", "https://b/2"), n("Seed round", "2026-10-09", "https://a/3"), n("Seed round", "2026-10-09", "https://a/3")]);
    expect(out.map((x) => x.url)).toEqual(["https://b/2", "https://a/3"]);
  });
});

describe("fetchNews: a failed source is reported, never mistaken for 'no news'", () => {
  it("returns the stories that loaded and says which sources failed and why", async () => {
    const good = `<rss><channel><item><title>Venture fund raises new capital</title><link>https://ok.example/1</link><pubDate>Sun, 11 Oct 2026 09:00:00 GMT</pubDate><description>A fund.</description></item></channel></rss>`;
    const fake = (async (u: unknown) => {
      const url = String(u);
      if (url.includes("techcrunch")) return new Response(good, { status: 200 });
      if (url.includes("inc42")) return new Response("nope", { status: 503 });
      throw new Error("network down");
    }) as typeof fetch;
    const r = await fetchNews({ fetchImpl: fake, now: NOW });
    expect(r.items.map((i) => i.title)).toEqual(["Venture fund raises new capital"]);
    expect(r.status.find((s) => s.id === "techcrunch")).toMatchObject({ ok: true, items: 1 });
    expect(r.status.find((s) => s.id === "inc42")).toMatchObject({ ok: false, note: "HTTP 503" });
    expect(r.status.find((s) => s.id === "sifted")).toMatchObject({ ok: false, note: "could not be reached" });
  });

  it("only ever reads the fixed publisher list (no user-supplied URL can reach it)", () => {
    for (const s of NEWS_SOURCES) expect(new URL(s.url).protocol).toBe("https:");
    expect(NEWS_SOURCES.length).toBe(5);
  });
});
