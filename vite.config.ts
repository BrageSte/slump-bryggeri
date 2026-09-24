import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare(), tailwindcss()],
  define: {
    // Versions the service worker cache per build.
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
});
