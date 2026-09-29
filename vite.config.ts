import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run e2e` sets E2E=1: an isolated Worker config (no .dev.vars, throwaway database).
const e2e = process.env.E2E === "1";

export default defineConfig({
  plugins: [
    react(),
    cloudflare(e2e ? { configPath: "./e2e/wrangler.jsonc", persistState: { path: "./.wrangler/e2e-state" } } : undefined),
    tailwindcss(),
  ],
  define: {
    // Versions the service worker cache per build.
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
});
