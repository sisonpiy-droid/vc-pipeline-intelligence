import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import type { Readable } from "node:stream";
import { ProviderError, type FetchedPage, type PageFetcher } from "./types";

/**
 * Fetches one public web page for evidence checking, defensively:
 *  - SSRF: http(s) on ports 80/443 only, no credentials in the URL; the address the socket actually
 *    connects to is validated inside the `lookup` hook (so DNS rebinding cannot swap in a private IP
 *    after a check), and every redirect hop is re-validated.
 *  - Bounded: 10 s timeout, 3 redirects, 1.5 MB, HTML/text only.
 *  - Polite: identifies itself and honours robots.txt.
 */
export const USER_AGENT = "VCPipelineBot/0.1 (investor signal verification; single-page fetches)";
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

export function isPublicAddress(addr: string): boolean {
  const v = isIP(addr);
  if (v === 4) {
    const [a, b, c] = addr.split(".").map(Number) as [number, number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false; // link-local incl. cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (v === 6) {
    const s = addr.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (s === "::" || s === "::1") return false;
    if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff")) return false; // ULA, link-local, multicast
    return true;
  }
  return false;
}

export interface FetcherOptions {
  /** Override for tests (point at a local server). Production default = isPublicAddress. */
  isAllowedAddress?: (addr: string) => boolean;
  timeoutMs?: number;
  respectRobots?: boolean;
}

export function createPageFetcher(opts: FetcherOptions = {}): PageFetcher {
  const allowed = opts.isAllowedAddress ?? isPublicAddress;
  const robotsCache = new Map<string, { at: number; rules: RobotsRules | "deny_all" | "allow_all" }>();

  const guardedLookup: typeof dnsLookup = ((host: string, o: unknown, cb: unknown) => {
    const callback = (typeof o === "function" ? o : cb) as (err: Error | null, addr?: unknown, fam?: number) => void;
    const options = (typeof o === "object" && o ? o : {}) as { all?: boolean };
    dnsLookup(host, { all: true }, (err, addrs) => {
      if (err) return callback(err);
      const bad = addrs.find((a) => !allowed(a.address));
      if (bad) return callback(new ProviderError("blocked", "address not allowed") as unknown as Error);
      if (options.all) return callback(null, addrs);
      return callback(null, addrs[0]!.address, addrs[0]!.family);
    });
  }) as typeof dnsLookup;

  async function once(url: URL): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const lib = url.protocol === "https:" ? https : http;
      const req = lib.request(
        url,
        {
          method: "GET",
          lookup: guardedLookup,
          timeout: opts.timeoutMs ?? 10_000,
          headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "accept-encoding": "gzip, deflate, br" },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.resume();
            return resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
          }
          const type = String(res.headers["content-type"] ?? "").toLowerCase();
          if (status === 200 && type && !/^(text\/|application\/xhtml)/.test(type)) {
            res.destroy();
            return reject(new ProviderError("blocked", `unsupported content type ${type.split(";")[0]}`));
          }
          const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
          const stream: Readable = enc === "gzip" ? res.pipe(createGunzip()) : enc === "deflate" ? res.pipe(createInflate()) : enc === "br" ? res.pipe(createBrotliDecompress()) : res;
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX_BYTES) {
              stream.destroy();
              res.destroy();
              return resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }); // keep what we have
            }
            chunks.push(c);
          });
          stream.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
          stream.on("error", (e) => reject(e));
        },
      );
      req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
      req.on("error", reject);
      req.end();
    });
  }

  function validate(raw: string): URL {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new ProviderError("blocked", "invalid URL");
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new ProviderError("blocked", "only http(s) URLs are fetched");
    if (u.username || u.password) throw new ProviderError("blocked", "credentials in URL");
    if (u.port && u.port !== "80" && u.port !== "443" && opts.isAllowedAddress === undefined) throw new ProviderError("blocked", "non-standard port");
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !allowed(host)) throw new ProviderError("blocked", "address not allowed");
    return u;
  }

  async function robotsAllows(u: URL): Promise<boolean> {
    if (opts.respectRobots === false) return true;
    const key = u.origin;
    let entry = robotsCache.get(key);
    if (!entry || Date.now() - entry.at > 3_600_000) {
      let rules: NonNullable<typeof entry>["rules"] = "allow_all";
      try {
        const r = await once(new URL("/robots.txt", u.origin));
        if (r.status === 200) rules = parseRobots(r.body.toString("utf8"));
        else if (r.status >= 500) rules = "deny_all"; // RFC 9309: server error → assume disallowed
      } catch {
        rules = "deny_all"; // cannot verify permission → do not fetch
      }
      entry = { at: Date.now(), rules };
      robotsCache.set(key, entry);
    }
    if (entry.rules === "allow_all") return true;
    if (entry.rules === "deny_all") return false;
    return entry.rules.allows(u.pathname + u.search);
  }

  return {
    async fetch(raw): Promise<FetchedPage> {
      let url = validate(raw);
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!(await robotsAllows(url))) throw new ProviderError("blocked", "disallowed by robots.txt");
        let r;
        try {
          r = await once(url);
        } catch (e) {
          if (e instanceof ProviderError) throw e;
          const timeout = e instanceof Error && e.name === "TimeoutError";
          throw new ProviderError(timeout ? "timeout" : "blocked", timeout ? "page fetch timed out" : `page fetch failed: ${(e as Error).message}`);
        }
        if (r.status >= 300 && r.status < 400 && r.headers.location) {
          url = validate(new URL(String(r.headers.location), url).toString()); // re-validate every hop
          continue;
        }
        if (r.status === 429) throw new ProviderError("rate_limited", "page host rate-limited us", 429);
        if (r.status >= 500) throw new ProviderError("http_5xx", `page host error (${r.status})`, r.status);
        if (r.status !== 200) throw new ProviderError("http_4xx", `page returned ${r.status}`, r.status);
        return { finalUrl: url.toString(), html: r.body.toString("utf8") };
      }
      throw new ProviderError("blocked", "too many redirects");
    },
  };
}

// ───────────────────────────── robots.txt ─────────────────────────────
interface RobotsRules {
  allows(pathAndQuery: string): boolean;
}

/** Minimal RFC 9309: our own group (VCPipelineBot) wins over `*`; longest matching rule wins; Allow beats Disallow on ties. */
export function parseRobots(txt: string): RobotsRules | "allow_all" {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase(), val = m[2]!;
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && cur) {
      if (val) cur.rules.push({ allow: key === "allow", path: val });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && "vcpipelinebot".includes(a) && a.length > 2)) ?? groups.find((g) => g.agents.includes("*"));
  if (!mine || mine.rules.length === 0) return "allow_all";
  const toRe = (p: string) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  return {
    allows(path) {
      let best: { len: number; allow: boolean } | null = null;
      for (const r of mine.rules) {
        if (toRe(r.path).test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { len: r.path.length, allow: r.allow };
      }
      return best ? best.allow : true;
    },
  };
}
