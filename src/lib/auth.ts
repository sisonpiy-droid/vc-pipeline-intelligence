import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison (hashes first so length differences leak nothing either). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Vercel Cron calls with `Authorization: Bearer $CRON_SECRET` when the CRON_SECRET env var is set.
 * Fails closed: no secret configured → nobody is authorised.
 */
export function isCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") && safeEqual(h.slice(7), secret);
}

export type AdminCheck = "ok" | "disabled" | "denied" | "locked";

// Best-effort brute-force brake for the manual-refresh passcode. In-memory, so per serverless instance;
// the real cost guard is the DB-backed cooldown in refresh/service.ts.
// ponytail: swap for a shared store (DB row / KV) if distributed guessing becomes a concern.
const failures = new Map<string, { n: number; first: number }>();
const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 8;

export function checkAdmin(req: Request, ip: string): AdminCheck {
  const pass = process.env.ADMIN_PASSCODE;
  if (!pass) return "disabled";
  const f = failures.get(ip);
  if (f && Date.now() - f.first < WINDOW_MS && f.n >= MAX_FAILURES) return "locked";
  const given = req.headers.get("x-admin-passcode") ?? "";
  if (safeEqual(given, pass)) {
    failures.delete(ip);
    return "ok";
  }
  const cur = f && Date.now() - f.first < WINDOW_MS ? f : { n: 0, first: Date.now() };
  cur.n++;
  failures.set(ip, cur);
  return "denied";
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
