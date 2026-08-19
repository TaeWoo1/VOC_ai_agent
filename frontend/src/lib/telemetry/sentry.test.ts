import { describe, expect, it } from "vitest";
import { scrubEvent, scrubText, stripQuery } from "./sentryScrub";
import { pathTemplate, sentryOptionsFromEnv } from "./sentry";
import { buildCsp, sentryIngestOrigin } from "../security/csp";

/** docs/service_readiness_v1.md §2-1: OFF without a DSN, replay never loaded, PII/secrets scrubbed before send. */
describe("Sentry — env-gated, scrubbed", () => {
  it("has no options (nothing initialises) without VITE_SENTRY_DSN", () => {
    expect(sentryOptionsFromEnv({})).toBeNull();
    expect(sentryOptionsFromEnv({ VITE_SENTRY_DSN: "  " })).toBeNull();
  });

  it("builds options with PII off, no replay integration, traces only to /api, and a bounded sample rate", () => {
    const opts = sentryOptionsFromEnv({
      VITE_SENTRY_DSN: "https://abc123@o999.ingest.us.sentry.io/42",
      VITE_SELLEROPS_ENV: "staging",
      VITE_SENTRY_TRACES_SAMPLE_RATE: "5",
    })!;
    expect(opts.sendDefaultPii).toBe(false);
    expect(opts.environment).toBe("staging");
    expect(opts.release).toMatch(/^sellerops-frontend@/);
    expect(opts.tracesSampleRate).toBe(1);
    expect((opts.integrations as Array<{ name: string }>).map((i) => i.name)).toEqual(["BrowserTracing"]);
    expect(JSON.stringify((opts.integrations as Array<{ name: string }>).map((i) => i.name))).not.toMatch(/Replay/);
    expect(opts.tracePropagationTargets).toEqual([/^\/api\//]);
    expect(sentryOptionsFromEnv({ VITE_SENTRY_DSN: "https://k@h/1" })!.tracesSampleRate).toBe(0.1);
    expect(sentryOptionsFromEnv({ VITE_SENTRY_DSN: "https://k@h/1", VITE_SENTRY_TRACES_SAMPLE_RATE: "0" })!.tracesSampleRate).toBe(0);
  });

  it("scrubs the request, user, breadcrumbs and secret-shaped text", () => {
    const event = scrubEvent({
      user: { id: "u", email: "seller@x.io" },
      request: {
        url: "https://app/auth/callback?code=ONE-TIME",
        query_string: "code=ONE-TIME",
        cookies: "a=b",
        data: "{}",
        headers: { Authorization: "Bearer eyJ.abc.def", Cookie: "x", Accept: "*/*" },
      },
      breadcrumbs: [
        { message: "fetch token=T", data: { url: "/reset-password?token=T", "http.query": "token=T", arguments: ["seller@x.io"] } },
        // The SDK's navigation crumb: from/to = path + query (review B2).
        { data: { from: "/reset-password?token=T", to: "/login?reset=1" } },
      ],
      message: "Bearer AAAAAAAAAAAA failed",
      exception: { values: [{ value: "onboardingToken=abc expired" }] },
      transaction: "/reset-password?token=T",
      extra: { anything: "seller@x.io" },
      contexts: { state: { redux: {} }, browser: { name: "Chrome" } },
    });
    const json = JSON.stringify(event);
    expect(json).not.toMatch(/seller@x\.io|ONE-TIME|eyJ|token=T|AAAAAAAAAAAA|onboardingToken=abc/);
    expect(event.request!.url).toBe("https://app/auth/callback");
    expect(event.request!.headers).toEqual({ Accept: "*/*" });
    expect(event.transaction).toBe("/reset-password");
    expect(event.breadcrumbs![1].data).toEqual({ from: "/reset-password", to: "/login" });
    // An email in free text (a DB unique-key detail) is redacted too (review S3).
    expect(scrubText('Key (email)=(Seller.One@Example.co.kr) already exists')).toBe("Key (email)=([email]) already exists");
    // beforeBreadcrumb applies the same rule to a live SDK crumb.
    const opts = sentryOptionsFromEnv({ VITE_SENTRY_DSN: "https://k@h/1" })!;
    const crumb = opts.beforeBreadcrumb!({ category: "navigation", data: { from: "/auth/callback?code=C", to: "/" } }, {});
    expect(crumb!.data).toEqual({ from: "/auth/callback", to: "/" });
    expect(opts.beforeBreadcrumb!({ category: "console", message: "x" }, {})).toBeNull();
    expect(event.contexts).toEqual({ browser: { name: "Chrome" } });
    expect(scrubText("이메일 또는 비밀번호가 올바르지 않습니다")).toBe("이메일 또는 비밀번호가 올바르지 않습니다");
    expect(stripQuery(undefined)).toBeUndefined();
  });

  it("groups API errors by a UUID-free path template", () => {
    expect(pathTemplate("/api/channels/3f1c2a4b-1234-4abc-9def-1234567890ab/reviews")).toBe("/api/channels/:id/reviews");
  });
});

/** docs/service_readiness_v1.md §2-5: the CSP names exactly the vendors the build enabled. */
describe("frontend CSP from env", () => {
  it("is self-only with nothing configured", () => {
    const csp = buildCsp({});
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:8787;");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/googletagmanager|posthog|sentry/);
    // The Agent Runtime default origin is always reachable; the bridge only when enabled.
    expect(csp).toContain("http://127.0.0.1:8787");
    expect(csp).not.toContain("47615");
    expect(csp).not.toContain("blob:");
    const bridged = buildCsp({ VITE_ENABLE_AGENT_BRIDGE: "true" });
    expect(bridged).toContain("http://127.0.0.1:47615");
    expect(bridged).toContain("ws://127.0.0.1:47615");
    expect(bridged).toMatch(/img-src [^;]*blob:/);
  });

  it("adds GTM/GA, PostHog, Sentry ingest and split-origin API/agent origins — each only when set", () => {
    const csp = buildCsp({
      VITE_GTM_ID: "GTM-ABC123",
      VITE_POSTHOG_KEY: "phc_x",
      VITE_POSTHOG_HOST: "https://eu.i.posthog.com/",
      VITE_SENTRY_DSN: "https://abc123@o999.ingest.us.sentry.io/42",
      VITE_API_BASE_URL: "https://api.example.test",
      VITE_AGENT_RUNTIME_URL: "http://127.0.0.1:8787",
    });
    expect(csp).toMatch(/script-src 'self' https:\/\/www\.googletagmanager\.com https:\/\/eu\.i\.posthog\.com;/);
    expect(csp).toContain("https://*.google-analytics.com");
    expect(csp).toContain("https://o999.ingest.us.sentry.io");
    expect(csp).toContain("https://api.example.test");
    expect(csp).toContain("http://127.0.0.1:8787");
    expect(csp).not.toContain("abc123@");
    expect(sentryIngestOrigin("not a dsn")).toBeNull();
    expect(buildCsp({ VITE_API_BASE_URL: "javascript:alert(1)" })).not.toContain("javascript");
  });
});
