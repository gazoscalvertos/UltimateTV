import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/test/**/*.test.ts", "hub/test/**/*.test.ts", "tools/probe/test/**/*.test.ts", "ui/test/**/*.test.ts", "box/test/**/*.test.ts"],
  },
});
