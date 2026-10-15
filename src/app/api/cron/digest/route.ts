import { NextRequest, NextResponse } from "next/server";
import { isCron } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildDigest, sendTelegram } from "@/lib/digest";
import { today } from "@/lib/page";
import { listPipeline } from "@/lib/read";
import { handoffBase } from "@/lib/refresh/service";

export const dynamic = "force-dynamic";

/** Daily report to Telegram. Vercel Cron calls this with GET + `Authorization: Bearer $CRON_SECRET`. Does nothing until the bot is set up. */
export async function GET(req: NextRequest) {
  if (!isCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return NextResponse.json({ sent: false, reason: "telegram_not_configured" });
  try {
    const rows = await listPipeline(getDb(), today(), false);
    const r = await sendTelegram(buildDigest(rows, today(), handoffBase(req.nextUrl.origin)), token, chatId);
    return NextResponse.json({ sent: r.ok, status: r.status }, { status: r.ok ? 200 : 502 });
  } catch (e) {
    console.error("[digest failed]", e instanceof Error ? e.message.replace(token, "***").slice(0, 200) : "unknown");
    return NextResponse.json({ sent: false, error: "digest_failed" }, { status: 500 });
  }
}
