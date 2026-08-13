import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirrors tsconfig's "@/*" -> "./*" so lib/nav.ts (and anything else) can use
// the same "@/..." imports under test as it does in the Next.js build.
export default defineConfig({
  test: { environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
