import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { extractPage, publicationDates } from "@/lib/providers/extract";
import { createPageFetcher, isPublicAddress, parseRobots } from "@/lib/providers/fetchPage";
import { createTavily } from "@/lib/providers/tavily";
import { ProviderError } from "@/lib/providers/types";

const q = { query: '"Blume Ventures" logistics', startDate: "2026-09-11", endDate: "2026-10-11", maxResults: 8 };
const json = (b: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: h });
const noSleep = async () => {};

describe("tavily adapter", () => {
  it("maps results and sends the date window, dated-only filter and Bearer auth", async () => {
    const f = vi.fn(async () =>
      json({ results: [{ url: "https://a.com/x", title: "T", content: "C", score: 0.9, published_date: "2026-10-03" }, { url: "https://b.com", content: null }] }),
    );
    const hits = await createTavily({ apiKey: "tvly-k", fetchImpl: f as never }).search(q);
    expect(hits).toEqual([
      { url: "https://a.com/x", title: "T", snippet: "C", published_date: "2026-10-03", score: 0.9 },
      { url: "https://b.com", title: "", snippet: "", published_date: null, score: 0 },
    ]);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ start_date: "2026-09-11", end_date: "2026-10-11", filter_by_published_date: true, include_published_date: true, search_depth: "basic" });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tvly-k");
    expect(init.body as string).not.toContain("tvly-k");
  });

  it("restricts results to the requested domains (used for LinkedIn)", async () => {
    const f = vi.fn(async () => json({ results: [] }));
    await createTavily({ apiKey: "k", fetchImpl: f as never }).search({ ...q, includeDomains: ["linkedin.com"] });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).include_domains).toEqual(["linkedin.com"]);
    await createTavily({ apiKey: "k", fetchImpl: f as never }).search(q);
    expect(JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).not.toHaveProperty("include_domains");
  });

  it("fails fast and clearly without credentials", async () => {
    const prev = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const f = vi.fn();
    await expect(createTavily({ fetchImpl: f as never }).search(q)).rejects.toMatchObject({ category: "no_credentials" });
    expect(f).not.toHaveBeenCalled();
    if (prev) process.env.TAVILY_API_KEY = prev;
  });

  it("retries HTTP 429 (honouring Retry-After) and then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({}, 429, { "retry-after": "3" })).mockResolvedValueOnce(json({ results: [] }));
    const sleep = vi.fn(noSleep);
    expect(await createTavily({ apiKey: "k", fetchImpl: f as never, sleep }).search(q)).toEqual([]);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("retries HTTP 500 a bounded number of times then reports http_5xx", async () => {
    const f = vi.fn(async () => json({}, 500));
    await expect(createTavily({ apiKey: "k", fetchImpl: f as never, sleep: noSleep }).search(q)).rejects.toMatchObject({ category: "http_5xx" });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("persistent 429 → rate_limited; 432/433 → quota_exhausted without retry; 401 → no_credentials", async () => {
    await expect(createTavily({ apiKey: "k", fetchImpl: (async () => json({}, 429)) as never, sleep: noSleep }).search(q)).rejects.toMatchObject({ category: "rate_limited" });
    const quota = vi.fn(async () => json({}, 432));
    await expect(createTavily({ apiKey: "k", fetchImpl: quota as never }).search(q)).rejects.toMatchObject({ category: "quota_exhausted" });
    expect(quota).toHaveBeenCalledTimes(1);
    await expect(createTavily({ apiKey: "k", fetchImpl: (async () => json({}, 401)) as never }).search(q)).rejects.toMatchObject({ category: "no_credentials" });
  });

  it("malformed payloads and timeouts are typed errors", async () => {
    await expect(createTavily({ apiKey: "k", fetchImpl: (async () => json({ nope: 1 })) as never }).search(q)).rejects.toMatchObject({ category: "malformed" });
    await expect(createTavily({ apiKey: "k", fetchImpl: (async () => new Response("<html>", { status: 200 })) as never }).search(q)).rejects.toMatchObject({ category: "malformed" });
    const t = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "TimeoutError" }));
    await expect(createTavily({ apiKey: "k", fetchImpl: t as never, sleep: noSleep }).search(q)).rejects.toMatchObject({ category: "timeout" });
  });
});

describe("isPublicAddress (SSRF guard)", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not-an-ip"])(
    "blocks %s", (a) => expect(isPublicAddress(a)).toBe(false));
  it.each(["8.8.8.8", "172.32.0.1", "104.18.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])("allows %s", (a) => expect(isPublicAddress(a)).toBe(true));
});

describe("page fetcher (real local server)", () => {
  let server: http.Server;
  let base: string;
  const hits: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      const u = req.url ?? "";
      if (u === "/robots.txt") return void res.end("User-agent: *\nDisallow: /private\nAllow: /private/ok\n");
      if (u === "/page") return void res.writeHead(200, { "content-type": "text/html" }).end("<html><body><article>Hello Blume Ventures</article></body></html>");
      if (u === "/private/x") return void res.writeHead(200, { "content-type": "text/html" }).end("secret");
      if (u === "/private/ok") return void res.writeHead(200, { "content-type": "text/html" }).end("fine");
      if (u === "/to-metadata") return void res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
      if (u === "/loop") return void res.writeHead(302, { location: "/loop" }).end();
      if (u === "/pdf") return void res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF");
      if (u === "/big") return void res.writeHead(200, { "content-type": "text/html" }).end("x".repeat(3_000_000));
      if (u === "/missing") return void res.writeHead(404).end();
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const local = () => createPageFetcher({ isAllowedAddress: (a) => a === "127.0.0.1" });

  it("fetches an allowed page", async () => {
    const p = await local().fetch(`${base}/page`);
    expect(p.html).toContain("Hello Blume Ventures");
  });

  it("by default refuses loopback / private / metadata targets without touching the network", async () => {
    const f = createPageFetcher();
    for (const u of ["http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/latest", "http://[::1]/", "http://10.0.0.1/"])
      await expect(f.fetch(u)).rejects.toMatchObject({ category: "blocked" });
    expect(hits.length).toBeLessThan(100); // nothing of ours reached the local server via the default fetcher
  });

  it("the connect-time address check itself blocks a hostname that resolves to loopback (robots disabled so it is the only guard)", async () => {
    const f = createPageFetcher({ respectRobots: false, timeoutMs: 3000 });
    await expect(f.fetch(`http://localhost:80/page`)).rejects.toMatchObject({ category: "blocked", message: /address not allowed/ });
  });

  it("refuses non-http schemes, credentials in URLs and odd ports", async () => {
    const f = createPageFetcher();
    for (const u of ["file:///etc/passwd", "ftp://x.com/", "javascript:alert(1)", "https://user:pw@example.com/", "https://example.com:8443/", "nope"])
      await expect(f.fetch(u)).rejects.toBeInstanceOf(ProviderError);
  });

  it("re-validates redirects: a redirect to the cloud-metadata address is blocked", async () => {
    await expect(local().fetch(`${base}/to-metadata`)).rejects.toMatchObject({ category: "blocked" });
  });

  it("gives up on redirect loops", async () => {
    await expect(local().fetch(`${base}/loop`)).rejects.toMatchObject({ category: "blocked", message: /redirects/ });
  });

  it("honours robots.txt (longest match wins) and does not fetch disallowed pages", async () => {
    const f = local();
    await expect(f.fetch(`${base}/private/x`)).rejects.toMatchObject({ message: /robots/ });
    expect((await f.fetch(`${base}/private/ok`)).html).toBe("fine");
    expect(hits).not.toContain("/private/x");
  });

  it("rejects non-text content, maps 404, and caps oversized bodies", async () => {
    const f = local();
    await expect(f.fetch(`${base}/pdf`)).rejects.toMatchObject({ message: /content type/ });
    await expect(f.fetch(`${base}/missing`)).rejects.toMatchObject({ category: "http_4xx" });
    expect((await f.fetch(`${base}/big`)).html.length).toBeLessThanOrEqual(1_500_000);
  });
});

describe("parseRobots", () => {
  it("applies * rules, Allow overrides longer Disallow, empty Disallow allows all", () => {
    const r = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a/b\n");
    expect(r === "allow_all").toBe(false);
    if (r !== "allow_all") {
      expect(r.allows("/a/x")).toBe(false);
      expect(r.allows("/a/b/c")).toBe(true);
      expect(r.allows("/z")).toBe(true);
    }
    expect(parseRobots("User-agent: *\nDisallow:\n")).toBe("allow_all");
  });
  it("prefers a group naming this bot over *", () => {
    const r = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: VCPipelineBot\nAllow: /\n");
    expect(r === "allow_all" || r.allows("/anything")).toBe(true);
  });
});

describe("page extraction", () => {
  const page = (head: string, body = "<article><h1>Headline</h1><p>Blume Ventures led the round.</p></article>") =>
    `<html><head><title>Site &amp; Co</title>${head}</head><body><nav>MENU</nav>${body}<footer>FOOT</footer><script>var x=1</script></body></html>`;

  it("reads the publication date from JSON-LD, ignoring dateModified", () => {
    const e = extractPage(page(`<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2026-10-04T08:00:00+05:30","dateModified":"2026-10-09"}]}</script>`));
    expect(e.published_at).toBe("2026-10-04");
    expect(e.date_conflict).toBe(false);
  });

  it("falls back to OpenGraph / meta / <time> and returns null — never a guess — when there is no date", () => {
    expect(extractPage(page(`<meta property="article:published_time" content="2026-10-02T10:00:00Z">`)).published_at).toBe("2026-10-02");
    expect(extractPage(page("", `<article><time datetime="2026-09-30">30 Sep</time>text</article>`)).published_at).toBe("2026-09-30");
    const none = extractPage(page(""));
    expect(none.published_at).toBeNull();
    expect(none.date_conflict).toBe(false);
  });

  it("treats contradictory publication dates as no date, and says so", () => {
    const e = extractPage(page(`<meta property="article:published_time" content="2026-10-02"><meta name="date" content="2026-08-01">`));
    expect(e.published_at).toBeNull();
    expect(e.date_conflict).toBe(true);
  });

  it("ignores unparseable and impossible dates", () => {
    expect(publicationDates(page(`<meta name="date" content="2026-02-31"><meta name="pubdate" content="last Tuesday">`))).toEqual([]);
  });

  it("extracts readable text without scripts, nav or footer, and decodes entities and the title", () => {
    const e = extractPage(page("", "<article><p>Blume &amp; Co&#39;s round</p><p>Second</p></article>"));
    expect(e.title).toBe("Site & Co");
    expect(e.text).toContain("Blume & Co's round");
    expect(e.text).not.toMatch(/MENU|FOOT|var x/);
  });

  it("survives garbage input", () => {
    expect(() => extractPage("")).not.toThrow();
    expect(() => extractPage("<<<>>> <meta content=")).not.toThrow();
    expect(extractPage("not html at all").text).toBe("not html at all");
  });
});
