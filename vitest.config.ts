import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
