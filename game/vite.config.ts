import { defineConfig } from "vite";

export default defineConfig({
  // Относительные пути: сборку можно открыть из любой папки и выложить на статический хостинг.
  base: "./",
  build: { target: "es2020", sourcemap: true },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 600000, hookTimeout: 120000 },
});
