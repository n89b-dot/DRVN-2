import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["tests/operations/**/*.test.ts"], testTimeout: 60000, hookTimeout: 60000, fileParallelism: false },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)) } },
});
