import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { initAnalyticsFromEnv } from "./lib/analytics";
import { initSentryFromEnv } from "./lib/telemetry/sentry";
import { ConsentProvider } from "./lib/consent/ConsentProvider";
import { RootErrorBoundary } from "./components/app/RootErrorBoundary";
import "./index.css";

// Error monitoring first, env-gated: no VITE_SENTRY_DSN (local/dev) → nothing initialises
// (docs/service_readiness_v1.md §2-1).
initSentryFromEnv();
// One abstraction, env-gated: with no VITE_GTM_ID / VITE_POSTHOG_KEY (local/dev) nothing loads and every
// `analytics.track` is a no-op — docs/auth_growth_instrumentation_v1.md §2-8. Sinks start only under 분석 consent.
initAnalyticsFromEnv();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <ConsentProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ConsentProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  </React.StrictMode>,
);
