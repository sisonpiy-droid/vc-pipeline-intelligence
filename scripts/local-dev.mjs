// Local design loop: the e2e world (throwaway database, no provider keys) served by next dev with hot reload.
process.env.E2E_DEV = "1";
await import("./e2e-server.mjs");
