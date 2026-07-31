import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev API proxy target. The frontend calls SAME-ORIGIN `/api/*` (see apiClient.ts BASE_URL), and the dev
// server forwards those to the backend here. Overriding the port for a disposable/walkthrough backend is
// done by exporting SELLEROPS_BACKEND_ORIGIN before `npm run dev` — NOT by editing an absolute
// VITE_API_BASE_URL (which is exactly the stale-port failure this proxy removes). Same-origin also avoids
// the localhost/127.0.0.1 CORS mismatch that broke a past login.
const BACKEND_ORIGIN = process.env.SELLEROPS_BACKEND_ORIGIN ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: BACKEND_ORIGIN,
        changeOrigin: true,
      },
    },
  },
});
