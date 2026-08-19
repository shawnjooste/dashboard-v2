import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirrors tsconfig's "@/*" -> "./*" so lib/nav.ts (and anything else) can use
// the same "@/..." imports under test as it does in the Next.js build.
//
// "server-only" is a marker package Next's bundler strips out for server
// code; it isn't a real resolvable dependency outside Next's own build, so a
// file that imports it (e.g. lib/api/auth.ts) can't load under plain Node
// resolution at all. Alias it to Next's own no-op shim — the same empty
// module Next substitutes when the marker doesn't apply — so such files stay
// testable under vitest without weakening the "server-only" guard anywhere
// it actually matters (the real Next build).
export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "node_modules/next/dist/compiled/server-only/empty.js"),
    },
  },
});
