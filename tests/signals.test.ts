import { describe, expect, it } from "vitest";
import { dedupeSignals, headlineSimilarity } from "@/lib/signals/dedupe";
import { mentionsInvestor } from "@/lib/signals/match";
import { ageInDays, checkWindow, parseDate, windowStart } from "@/lib/signals/window";

const NOW = new Date("2026-10-11T12:00:00Z");

describe("date window", () => {
  it("window starts 30 days before now", () => expect(windowStart(NOW)).toBe("2026-09-11"));

  it.each([
    ["2026-10-11", true], // today
    ["2026-09-11", true], // exactly 30 days — inclusive
    ["2026-09-10", false], // 31 days — out
    ["2026-10-12", true], // 1 day ahead tolerated (time zones)
    ["2026-10-20", false], // future
  ])("checkWindow(%s) → ok=%s", (d, ok) => expect(checkWindow(d, NOW).ok).toBe(ok));

  it("missing date is rejected, never defaulted to 'recent'", () => {
    expect(checkWindow(null, NOW)).toEqual({ ok: false, reason: "missing_date" });
    expect(checkWindow("2026-08-01", NOW)).toEqual({ ok: false, reason: "out_of_window" });
    expect(checkWindow("2026-12-25", NOW)).toEqual({ ok: false, reason: "future_date" });
  });

  it("ageInDays counts UTC calendar days", () => expect(ageInDays("2026-10-01", NOW)).toBe(10));

  describe("parseDate is strict", () => {
    it.each([
      ["2026-10-05", "2026-10-05"],
      ["2026-10-05T09:30:00+05:30", "2026-10-05"],
      ["2026-10-05 09:30", "2026-10-05"],
      ["12 October 2026", "2026-10-12"],
      ["Oct 3, 2026", "2026-10-03"],
      ["Thu, 08 Oct 2026 21:00:00 GMT", "2026-10-08"], // search-provider format; must not shift with the server time zone
    ])("%j → %j", (input, out) => expect(parseDate(input)).toBe(out));

    it.each(["2026-02-31", "01/02/2026", "yesterday", "", null, "2026-13-01", "n/a"])("rejects %j", (input) =>
      expect(parseDate(input as string | null)).toBeNull(),
    );
  });
});

describe("mentionsInvestor (entity matching)", () => {
  const blume = { firm_name: "Blume Ventures", aliases: [] as string[] };
  const matrix = { firm_name: "Matrix Partners India", aliases: ["Z47"] };

  it("matches full names regardless of case and punctuation", () => {
    expect(mentionsInvestor("Raaho raises $5M led by BLUME VENTURES.", blume)).toBe(true);
    expect(mentionsInvestor("…backed by blume-ventures and others", blume)).toBe(true);
  });
  it("matches aliases from the source data", () => expect(mentionsInvestor("Z47 leads a Seed round", matrix)).toBe(true));
  it("does not match a different firm with a similar name or a partial word", () => {
    expect(mentionsInvestor("Blume Ventureship programme", blume)).toBe(false);
    expect(mentionsInvestor("Accel Partners backs startup", { firm_name: "Accel India", aliases: [] })).toBe(false);
    expect(mentionsInvestor("A generic logistics startup raised funding", blume)).toBe(false);
  });
  it("matches a founder-supplied partner name when present", () => {
    expect(mentionsInvestor("Karthik Reddy on logistics", { ...blume, partner_name: "Karthik Reddy" })).toBe(true);
    expect(mentionsInvestor("Karthik Reddy on logistics", blume)).toBe(false);
  });
});

describe("dedupeSignals", () => {
  const mk = (url: string, headline: string, published_at: string, authority = 1) => ({ canonical_url: url, headline, published_at, authority });

  it("collapses repeated coverage of one event, keeping the most authoritative copy", () => {
    const { kept, duplicates } = dedupeSignals([
      mk("https://news.com/a", "Blume Ventures leads Raaho Seed round in logistics", "2026-10-02"),
      mk("https://blume.vc/raaho", "Blume Ventures leads Raaho's Seed round in logistics", "2026-10-02", 5),
      mk("https://other.com/x", "Raaho raises Seed round led by Blume Ventures logistics", "2026-10-03"),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.canonical_url).toBe("https://blume.vc/raaho");
    expect(duplicates).toHaveLength(2);
  });

  it("is order-independent", () => {
    const items = [mk("https://a.com/1", "Fund announces new logistics thesis", "2026-10-02"), mk("https://b.com/1", "Fund announces new logistics thesis", "2026-10-02", 3)];
    expect(dedupeSignals(items).kept[0]!.canonical_url).toBe(dedupeSignals([...items].reverse()).kept[0]!.canonical_url);
  });

  it("keeps genuinely different events separate", () => {
    const { kept } = dedupeSignals([
      mk("https://a.com/1", "Blume Ventures leads Raaho Seed round", "2026-10-02"),
      mk("https://a.com/2", "Blume Ventures partner speaks at Logistics Summit panel", "2026-10-09"),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("same headline far apart in time is a different event", () => {
    const { kept } = dedupeSignals([mk("https://a.com/1", "Weekly investor newsletter logistics roundup", "2026-09-15"), mk("https://a.com/2", "Weekly investor newsletter logistics roundup", "2026-10-09")]);
    expect(kept).toHaveLength(2);
  });

  it("identical canonical URLs are always duplicates", () =>
    expect(dedupeSignals([mk("https://a.com/1", "One title", "2026-10-02"), mk("https://a.com/1", "Totally different", "2026-10-09")]).kept).toHaveLength(1));

  it("headlineSimilarity is symmetric and bounded", () => {
    const s = headlineSimilarity("Blume invests in Raaho", "Raaho gets Blume investment");
    expect(s).toBe(headlineSimilarity("Raaho gets Blume investment", "Blume invests in Raaho"));
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});
