import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000, // PGlite boot + migration per test file
    hookTimeout: 60_000, // cold-loading exceljs next to PGlite is slow on first run
    environment: "node",
  },
});
