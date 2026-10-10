"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While a run is in progress, re-fetch the server-rendered data every 8 s so progress is live. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
