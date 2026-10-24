import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// The Hub serves the built UI at /app/. In development, `npm run dev -w ui` proxies the API to a
// Hub on HUB_URL (start one with `DEMO=1 npm run dev:hub` for seeded data).
const hub = process.env.HUB_URL ?? "http://127.0.0.1:8095";

export default defineConfig({
  base: "/app/",
  plugins: [solid()],
  build: { target: "chrome120", outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: hub, ws: true },
      "/clips": hub,
    },
  },
});
