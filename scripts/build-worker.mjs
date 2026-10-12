/**
 * Bundle the worker entry into a single self-contained Node file so the
 * production image does not need tsx or the full source tree at runtime.
 *
 *   pnpm build:worker   ->  dist/worker.mjs
 *
 * Uses the `react-server` condition so `server-only` marker modules resolve
 * to their no-op export, and aliases `@/` to `src/` to match tsconfig paths.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [resolve(root, "src/workers/entry.ts")],
  outfile: resolve(root, "dist/worker.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  // CJS output: several transitive deps (form-data, combined-stream) use
  // dynamic require of Node builtins, which ESM output cannot shim.
  format: "cjs",
  conditions: ["react-server"],
  alias: { "@": resolve(root, "src") },
  // Bundle everything (including pino — the logger uses no transport, so it
  // runs synchronously and inlines cleanly). Only native/optional modules
  // stay external.
  external: ["sharp"],
  sourcemap: true,
  logLevel: "info",
});
