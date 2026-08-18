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
      // Social login (Google · NAVER) is a top-level browser navigation to the backend's Spring Security
      // OAuth2 endpoints. Proxied WITHOUT changeOrigin so the backend computes the redirect URI from the
      // origin the browser used (http://localhost:5173/login/oauth2/code/<provider>) — the one registered
      // at the provider console. docs/auth_growth_instrumentation_v1.md §3.
      "/oauth2": { target: BACKEND_ORIGIN, changeOrigin: false },
      "/login/oauth2": { target: BACKEND_ORIGIN, changeOrigin: false },
    },
  },
});
