import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const dataDir = fileURLToPath(new URL("./data", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@data": dataDir,
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
