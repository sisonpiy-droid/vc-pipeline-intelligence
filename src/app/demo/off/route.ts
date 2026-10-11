import { NextRequest, NextResponse } from "next/server";
import { MODE_COOKIE } from "@/lib/demoData/mode";

export const dynamic = "force-dynamic";

/** Back to the real data. */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.delete(MODE_COOKIE);
  return res;
}
