import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const dataDir = fileURLToPath(new URL("./data", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@data": dataDir,
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "packages/eval/corpus/**"],
    environment: "node",
    passWithNoTests: true,
  },
});
