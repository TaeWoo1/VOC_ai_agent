/**
 * The frontend Content-Security-Policy (docs/service_readiness_v1.md §2-5), computed at BUILD time from the same
 * env that turns each vendor on, and injected as a `<meta http-equiv>` by vite.config.ts (production build only:
 * the dev server needs inline scripts for React refresh). Pure, so it is unit-tested. Every origin here answers
 * "why": nothing else may load a script into, or receive a request from, the app.
 *
 * Google / NAVER sign-in are top-level navigations (`/oauth2/authorization/*` → provider → back) — no CSP entry.
 * Adding an ad tag inside GTM later (Google Ads / Meta / NAVER Ads) means adding its origins HERE too (§7).
 */
export interface CspEnv {
  VITE_GTM_ID?: string;
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
  VITE_SENTRY_DSN?: string;
  VITE_API_BASE_URL?: string;
  VITE_AGENT_RUNTIME_URL?: string;
  VITE_ENABLE_AGENT_BRIDGE?: string;
  VITE_BRIDGE_URL?: string;
}

/** Code defaults the CSP must mirror: `agentClient.ts` (Agent Runtime) and `bridgeClient.ts` (Local Agent Bridge). */
export const AGENT_RUNTIME_DEFAULT = "http://127.0.0.1:8787";
export const BRIDGE_DEFAULT = "http://127.0.0.1:47615";

const GA_ORIGINS = ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com"];
const GTM_SCRIPT = "https://www.googletagmanager.com";
const POSTHOG_DEFAULT = "https://us.i.posthog.com";

export function originOf(raw: string | undefined | null): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The Sentry ingest origin, from a DSN of the form `https://<key>@<host>/<project>`. */
export function sentryIngestOrigin(dsn: string | undefined | null): string | null {
  const origin = originOf(dsn?.replace(/\/\/[^@/]+@/, "//"));
  return origin;
}

export function buildCsp(env: CspEnv): string {
  const script = new Set(["'self'"]);
  const connect = new Set(["'self'"]);
  const img = new Set(["'self'", "data:"]);
  const gtm = !!env.VITE_GTM_ID?.trim();
  if (gtm) {
    script.add(GTM_SCRIPT);
    for (const o of GA_ORIGINS) {
      connect.add(o);
      img.add(o);
    }
  }
  if (env.VITE_POSTHOG_KEY?.trim()) {
    const host = originOf(env.VITE_POSTHOG_HOST) ?? POSTHOG_DEFAULT;
    script.add(host);
    connect.add(host);
  }
  const sentry = sentryIngestOrigin(env.VITE_SENTRY_DSN);
  if (sentry) connect.add(sentry);
  const api = originOf(env.VITE_API_BASE_URL);
  if (api) connect.add(api);
  // The Agent Runtime is a separate local origin the app always talks to (`agentClient.ts` default 8787).
  connect.add(originOf(env.VITE_AGENT_RUNTIME_URL) ?? AGENT_RUNTIME_DEFAULT);
  // The Local Agent Bridge (Action Window) — http + websocket on one origin, and blob: frames in <img>.
  if (env.VITE_ENABLE_AGENT_BRIDGE?.trim() === "true") {
    const bridge = originOf(env.VITE_BRIDGE_URL) ?? BRIDGE_DEFAULT;
    connect.add(bridge);
    connect.add(bridge.replace(/^http/, "ws"));
    img.add("blob:");
  }
  return [
    "default-src 'self'",
    `script-src ${[...script].join(" ")}`,
    `connect-src ${[...connect].join(" ")}`,
    `img-src ${[...img].join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
