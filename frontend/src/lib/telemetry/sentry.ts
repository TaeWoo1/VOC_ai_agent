import * as Sentry from "@sentry/react";
import { scrubBreadcrumbData, scrubEvent, scrubText, stripQuery } from "./sentryScrub";

/**
 * Error monitoring — docs/service_readiness_v1.md §2-1. Env-gated: no `VITE_SENTRY_DSN` (the local/dev
 * default) → nothing initialises and every helper here is a no-op. Session replay is not imported. PII off,
 * every event scrubbed (`sentryScrub.ts`), traces only to same-origin `/api/`.
 */
export interface SentryEnv {
  VITE_SENTRY_DSN?: string;
  VITE_SELLEROPS_ENV?: string;
  VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
}

declare const __SELLEROPS_RELEASE__: string;

export function releaseId(): string {
  try {
    return typeof __SELLEROPS_RELEASE__ === "string" && __SELLEROPS_RELEASE__ ? __SELLEROPS_RELEASE__ : "unknown";
  } catch {
    return "unknown";
  }
}

export function sentryOptionsFromEnv(env: SentryEnv): Sentry.BrowserOptions | null {
  const dsn = env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return null;
  const rate = Number.parseFloat(env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? "");
  return {
    dsn,
    environment: env.VITE_SELLEROPS_ENV?.trim() || "local",
    release: `sellerops-frontend@${releaseId()}`,
    sendDefaultPii: false,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0.1,
    tracePropagationTargets: [/^\/api\//],
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeSendTransaction(event) {
      return scrubEvent(event);
    },
    beforeBreadcrumb(crumb) {
      if (crumb.category === "console") return null;
      // Navigation crumbs carry `from`/`to` (path + query), fetch/xhr crumbs `url` — none may keep a query.
      scrubBreadcrumbData(crumb.data);
      if (crumb.message) crumb.message = scrubText(crumb.message);
      return crumb;
    },
  };
}

let active = false;

export function initSentryFromEnv(env: SentryEnv = import.meta.env as unknown as SentryEnv): boolean {
  const options = sentryOptionsFromEnv(env);
  if (!options) return false;
  Sentry.init(options);
  active = true;
  return true;
}

export function sentryActive(): boolean {
  return active;
}

/**
 * An API failure worth an incident: the backend answered ≥ 500, or did not answer at all. 4xx are the flow's
 * own answers (wrong password, expired link) and stay on the screen that asked. Grouped by method + path
 * template (UUIDs collapsed) + status; the query string never travels.
 */
export function captureApiError(error: unknown): void {
  if (!active) return;
  // A request the app itself cancelled (unmount, timeout race) is not an incident.
  if ((error as { code?: string } | undefined)?.code === "ERR_CANCELED") return;
  const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
  const config = (error as { config?: { method?: string; url?: string } } | undefined)?.config;
  if (typeof status === "number" && status < 500) return;
  const method = (config?.method ?? "get").toUpperCase();
  const path = pathTemplate(stripQuery(config?.url) ?? "");
  const kind = typeof status === "number" ? `HTTP ${status}` : "no response";
  Sentry.captureMessage(`API ${kind}: ${method} ${path}`, {
    level: "error",
    fingerprint: ["api-error", method, path, String(status ?? "none")],
    tags: { api_method: method, api_path: path, api_status: String(status ?? "none") },
  });
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function pathTemplate(path: string): string {
  return path.replace(UUID, ":id");
}
