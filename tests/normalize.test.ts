import { describe, expect, it } from "vitest";
import { canonicalUrl, nameKey, splitAliases, splitList } from "@/lib/normalize";

describe("nameKey", () => {
  it.each([
    ["  pi Ventures", "pi ventures"],
    ["Blume Ventures", "blume ventures"],
    ["Blume  Ventures!", "blume ventures"],
    ["100X.VC", "100x vc"],
    ["Peak XV Partners", "peak xv partners"],
    ["Ünicorn & Co", "unicorn and co"],
  ])("%j → %j", (input, key) => expect(nameKey(input)).toBe(key));
});

describe("splitAliases / splitList", () => {
  it("splits on ' / ' only", () => {
    expect(splitAliases("Matrix Partners India / Z47")).toEqual({ name: "Matrix Partners India", aliases: ["Z47"] });
    expect(splitAliases("AI/ML Fund")).toEqual({ name: "AI/ML Fund", aliases: [] });
  });
  it("splits commas and semicolons, dropping case-insensitive repeats", () => {
    expect(splitList("Logistics, B2B SaaS; logistics ,deeptech")).toEqual(["Logistics", "B2B SaaS", "deeptech"]);
    expect(splitList(null)).toEqual([]);
  });
});

describe("canonicalUrl", () => {
  it("collapses equivalent URLs to one key", () => {
    const same = [
      "https://www.Example.com/a/b/?utm_source=x&id=1#top",
      "http://example.com/a/b?id=1&fbclid=abc",
      "https://example.com:443/a/b/?id=1",
    ];
    expect(new Set(same.map(canonicalUrl)).size).toBe(1);
    expect(canonicalUrl(same[0])).toBe("https://example.com/a/b?id=1");
  });
  it("keeps genuinely different pages apart", () => {
    expect(canonicalUrl("https://x.com/a?id=1")).not.toBe(canonicalUrl("https://x.com/a?id=2"));
    expect(canonicalUrl("https://x.com/a")).not.toBe(canonicalUrl("https://x.com/b"));
  });
  it("root path has no trailing slash and non-http schemes are rejected", () => {
    expect(canonicalUrl("https://blume.vc/")).toBe("https://blume.vc");
    expect(canonicalUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalUrl("ftp://x.com/f")).toBeNull();
    expect(canonicalUrl("not a url")).toBeNull();
    expect(canonicalUrl(null)).toBeNull();
  });
});
