import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The page runs on 9300. The server on 9310 answers /api and serves the assets/ folder on /library.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 9300,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:9310", timeout: 0, proxyTimeout: 0 },
      "/library": "http://127.0.0.1:9310",
    },
  },
});
