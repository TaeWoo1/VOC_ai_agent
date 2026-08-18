import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { initAnalyticsFromEnv } from "./lib/analytics";
import "./index.css";

// One abstraction, env-gated: with no VITE_GTM_ID / VITE_POSTHOG_KEY (local/dev) nothing loads and every
// `analytics.track` is a no-op — docs/auth_growth_instrumentation_v1.md §2-8.
initAnalyticsFromEnv();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
