import { describe, expect, it } from "vitest";
import { createAi, aiUsage } from "@/lib/ai/chain";
import { AiError } from "@/lib/ai/gemini";
import { createOpenRouter, modelFor, toJsonSchema } from "@/lib/ai/openrouter";

const REQ = { system: "s", prompt: "p", responseSchema: { type: "OBJECT", properties: { answer: { type: "STRING" } }, required: ["answer"] } };
const googleOk = (text: string) => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }), { status: 200 });
const routerOk = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }] }), { status: 200 });
const status = (n: number) => new Response("{}", { status: n });

/** A fetch that answers by host and records who was called. */
function net(google: () => Response | Promise<Response>, router: () => Response | Promise<Response> = () => routerOk('{"answer":"from router"}')) {
  const calls: string[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const h = (init?.headers ?? {}) as Record<string, string>;
    const key = String(h["x-goog-api-key"] ?? h.authorization ?? "");
    calls.push(u.includes("openrouter") ? "openrouter" : `google:${key.slice(0, 4)}`);
    return u.includes("openrouter") ? router() : google();
  }) as typeof fetch;
  return { impl, calls };
}
const sleep = async () => {};
const env = { GEMINI_API_KEY: "AAAA-one", OPENROUTER_API_KEY: "sk-or-v1-test" };

describe("the AI chain: the product keeps working when one route fails", () => {
  it("uses Google first and never touches the backup when Google answers", async () => {
    const n = net(() => googleOk('{"answer":"from google"}'));
    const out = await createAi({ env, fetchImpl: n.impl, sleep, log: () => {} }).generateJson(REQ);
    expect(out).toEqual({ answer: "from google" });
    expect(n.calls).toEqual(["google:AAAA"]);
  });

  it("falls over to the same model on OpenRouter when Google's quota is exhausted, and says so", async () => {
    const before = aiUsage.backupServed;
    const logs: string[] = [];
    const n = net(() => status(429));
    const out = await createAi({ env, fetchImpl: n.impl, sleep, log: (m) => logs.push(m) }).generateJson(REQ);
    expect(out).toEqual({ answer: "from router" });
    expect(n.calls.at(-1)).toBe("openrouter");
    expect(aiUsage.backupServed).toBe(before + 1);
    expect(logs.join(" ")).toContain("backup route");
  });

  it("tries a second Google key before paying for OpenRouter", async () => {
    const n = net(() => (n.calls.at(-1)?.startsWith("google:AAAA") ? status(429) : googleOk('{"answer":"from key two"}')));
    const out = await createAi({ env: { ...env, GEMINI_API_KEY_2: "BBBB-two" }, fetchImpl: n.impl, sleep, log: () => {} }).generateJson(REQ);
    expect(out).toEqual({ answer: "from key two" });
    expect(n.calls).not.toContain("openrouter");
  });

  it("skips a route that just hit its quota, so a long run does not wait on it for every call", async () => {
    let t = 1_000_000;
    const n = net(() => status(429));
    const ai = createAi({ env, fetchImpl: n.impl, sleep, now: () => t, log: () => {} });
    await ai.generateJson(REQ);
    const googleCalls = () => n.calls.filter((c) => c.startsWith("google")).length;
    const afterFirst = googleCalls();
    await ai.generateJson(REQ);
    expect(googleCalls()).toBe(afterFirst); // skipped while cooling down
    t += 61_000;
    await ai.generateJson(REQ);
    expect(googleCalls()).toBeGreaterThan(afterFirst); // tried again after the cooldown
  });

  it("does not shop a blocked prompt around: the same text would be blocked everywhere", async () => {
    const n = net(() => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 }));
    await expect(createAi({ env, fetchImpl: n.impl, sleep, log: () => {} }).generateJson(REQ)).rejects.toMatchObject({ category: "blocked" });
    expect(n.calls).not.toContain("openrouter");
  });

  it("reports the first route's error when every route fails, and 'no credentials' when none is set", async () => {
    const n = net(() => status(503), () => status(500));
    await expect(createAi({ env, fetchImpl: n.impl, sleep, log: () => {} }).generateJson(REQ)).rejects.toMatchObject({ category: "unavailable" });
    await expect(createAi({ env: {}, fetchImpl: n.impl, sleep }).generateJson(REQ)).rejects.toMatchObject({ category: "no_credentials" });
  });

  it("a rejected key (401) on Google also falls over, so a typo cannot take the site down", async () => {
    const n = net(() => status(401));
    expect(await createAi({ env, fetchImpl: n.impl, sleep, log: () => {} }).generateJson(REQ)).toEqual({ answer: "from router" });
  });
});

describe("the OpenRouter route", () => {
  it("asks for the same model and the same schema, with the types in lower case", async () => {
    let sent: { model: string; response_format: { json_schema: { schema: { type: string; properties: { answer: { type: string } } } } } } | null = null;
    const impl = (async (_u: unknown, init?: RequestInit) => { sent = JSON.parse(String(init?.body)); return routerOk('{"answer":"x"}'); }) as typeof fetch;
    await createOpenRouter({ apiKey: "k", model: modelFor({}), fetchImpl: impl }).generateJson(REQ);
    expect(sent!.model).toBe("google/gemini-3.6-flash");
    expect(sent!.response_format.json_schema.schema.type).toBe("object");
    expect(sent!.response_format.json_schema.schema.properties.answer.type).toBe("string");
  });

  it("follows GEMINI_MODEL, accepts a fenced reply, and maps its errors to the same categories", async () => {
    expect(modelFor({ GEMINI_MODEL: "gemini-3.7-flash" })).toBe("google/gemini-3.7-flash");
    expect(modelFor({ OPENROUTER_MODEL: "google/other" })).toBe("google/other");
    const fenced = (async () => routerOk('```json\n{"answer":"y"}\n```')) as typeof fetch;
    expect(await createOpenRouter({ apiKey: "k", fetchImpl: fenced }).generateJson(REQ)).toEqual({ answer: "y" });
    for (const [code, cat] of [[429, "rate_limited"], [402, "unavailable"], [401, "no_credentials"], [500, "unavailable"], [400, "bad_request"]] as const) {
      const f = (async () => status(code)) as typeof fetch;
      await expect(createOpenRouter({ apiKey: "k", fetchImpl: f }).generateJson(REQ)).rejects.toMatchObject({ category: cat });
    }
    await expect(createOpenRouter({ fetchImpl: fenced }).generateJson(REQ)).rejects.toBeInstanceOf(AiError);
  });

  it("converts nested Gemini schemas", () => {
    expect(toJsonSchema({ type: "OBJECT", properties: { a: { type: "ARRAY", items: { type: "STRING" } } }, propertyOrdering: ["a"] })).toEqual({ type: "object", properties: { a: { type: "array", items: { type: "string" } } } });
  });
});
