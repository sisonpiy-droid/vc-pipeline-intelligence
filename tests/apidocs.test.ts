import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/lib/apiDocs";

const ROOT = join(process.cwd(), "src", "app", "api");

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? routes(p) : n === "route.ts" ? [p] : [];
  });
}

/** Which HTTP methods does a route file export? */
const methodsOf = (file: string) => [...readFileSync(file, "utf8").matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]!);

describe("the API reference matches the code", () => {
  const found = routes(ROOT).flatMap((f) => {
    const path = "/api/" + relative(ROOT, f).split(sep).slice(0, -1).join("/");
    return methodsOf(f).map((m) => `${m} ${path}`);
  });
  const documented = ENDPOINTS.map((e) => `${e.method} ${e.path}`);

  it("every route handler is documented", () => {
    expect(found.filter((r) => !documented.includes(r))).toEqual([]);
  });

  it("every documented endpoint exists", () => {
    expect(documented.filter((d) => !found.includes(d))).toEqual([]);
  });

  it("every secret-protected endpoint states how it authenticates, and nothing documents a real secret", () => {
    for (const e of ENDPOINTS) {
      expect(e.auth.detail.length).toBeGreaterThan(10);
      expect(JSON.stringify(e)).not.toMatch(/sk-|AIza|tvly-|postgres(ql)?:\/\//);
    }
  });

  it("every endpoint is explained in plain words: a short title and a story", () => {
    for (const e of ENDPOINTS) {
      expect(e.plain.length, e.path).toBeGreaterThan(5);
      expect(e.plain.length, e.path).toBeLessThanOrEqual(45);
      expect(e.story.length, e.path).toBeGreaterThan(40);
    }
  });
});
