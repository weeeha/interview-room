import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const target = process.env.API_TARGET || "http://localhost:8941";

export default defineConfig({
  root: "app",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  test: {
    root: ".",
    include: ["{server,shared,app,scripts}/**/*.test.{ts,tsx}"],
    environment: "node",
  },
  server: {
    port: Number(process.env.APP_PORT || 8940),
    strictPort: true,
    proxy: { "/api": target, "/media": target },
  },
});
