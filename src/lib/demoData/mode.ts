import { cookies } from "next/headers";

/**
 * Demo mode is a VIEW, selected by a cookie: "demo" shows only the synthetic demo investors, anything else shows only real
 * data. The two are never mixed on a page (see `is_demo` in migration 0007). The cookie carries no secret and grants nothing:
 * the demo-only actions are still checked by the server like any other write.
 */
export const MODE_COOKIE = "vc_mode";

export async function isDemoView(): Promise<boolean> {
  return (await cookies()).get(MODE_COOKIE)?.value === "demo";
}
