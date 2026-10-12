"use client";

/** Shared by the startup forms: one fetch helper that turns every outcome into a message a person can act on, and the passcode field. */
export type Msg = { tone: "good" | "bad" | "warn"; text: string };

export async function callApi(url: string, method: "POST" | "DELETE", body: unknown, pass: string): Promise<{ status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json", ...(pass ? { "x-admin-passcode": pass } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: ((await res.json().catch(() => ({}))) as Record<string, unknown>) ?? {} };
  } catch {
    return { status: 0, data: {} };
  }
}

export function failure(status: number, data: Record<string, unknown>): Msg {
  if (status === 0) return { tone: "bad", text: "Network error: could not reach the server." };
  if (status === 401) return { tone: "bad", text: "Wrong passcode." };
  if (status === 429) return { tone: "bad", text: "Too many wrong attempts. Try again later." };
  if (status === 503) return { tone: "warn", text: String(data.message ?? "This is not enabled on this server.") };
  if (status === 400 && Array.isArray(data.issues)) return { tone: "bad", text: (data.issues as { field: string; message: string }[]).map((i) => `${i.field}: ${i.message}`).join("; ") };
  return { tone: "bad", text: String(data.message ?? `Something went wrong (HTTP ${status}).`) };
}

export const TONE = { good: "text-good", bad: "text-bad", warn: "text-warn" } as const;

export function PassField({ pass, setPass }: { pass: string; setPass: (v: string) => void }) {
  return (
    <div>
      <label htmlFor="startup-pass" className="block text-sm font-medium">Admin passcode</label>
      <input id="startup-pass" type="password" autoComplete="off" required value={pass} onChange={(e) => setPass(e.target.value)} className="mt-2 w-full max-w-xs rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
    </div>
  );
}
