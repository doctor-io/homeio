import { defineConfig } from "vitest/config";
import config from "./vitest.config";

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    setupFiles: [],
    include: ["test/integration/**/*.integration.ts"],
    hookTimeout: 30_000,
  },
});
