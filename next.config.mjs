const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Deliberately no script-src: Next.js hydration uses inline scripts, and a strict policy needs per-request
  // nonces (middleware). These directives still block framing, <base> hijacking, plugins and cross-origin form posts.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
];

/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  // Loaded from node_modules, not bundled: pg is a native-style driver; PGlite (dev/test only) locates its
  // WASM files via import.meta.url, which the bundler rewrites.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};
