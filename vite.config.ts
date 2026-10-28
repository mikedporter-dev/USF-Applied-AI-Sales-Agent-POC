import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two static pages: the marketing site (/) and the account workspace (/app/).
// In dev, /api/* is proxied to `wrangler dev` running the Worker on :8787.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        app: resolve(import.meta.dirname, "app/index.html"),
        notFound: resolve(import.meta.dirname, "404.html"),
      },
    },
  },
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
});
