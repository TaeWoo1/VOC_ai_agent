// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createAnalytics } from "./analytics";
import { ANALYTICS_EVENT_NAMES, analyticsChannel, sanitize } from "./events";
import { createGtmSink, isValidGtmId } from "./gtmSink";
import { createPosthogSink, POSTHOG_INIT_OPTIONS, type PosthogLike } from "./posthogSink";
import { initialConsent, sinksFromEnv } from "./index";
import type { AnalyticsSink, ConsentGrant } from "./sink";

const GRANTED: ConsentGrant = { analytics: true, marketing: false };

function recordingSink(name = "rec"): AnalyticsSink & { calls: unknown[]; started: number } {
  const sink = {
    name,
    calls: [] as unknown[],
    started: 0,
    start() {
      sink.started += 1;
    },
    consent(grant: ConsentGrant) {
      sink.calls.push(["consent", grant]);
    },
    track(event: string, props: Record<string, string>) {
      sink.calls.push(["track", event, props]);
    },
    identify(userId: string | null) {
      sink.calls.push(["identify", userId]);
    },
  };
  return sink;
}

describe("analytics — one abstraction, env-gated, PII impossible by construction", () => {
  it("is OFF with no env: no sinks, track is a silent no-op", () => {
    expect(sinksFromEnv({})).toEqual([]);
    expect(sinksFromEnv({ VITE_GTM_ID: "", VITE_POSTHOG_KEY: " " })).toEqual([]);
    const a = createAnalytics(() => {});
    a.init([]);
    a.setConsent(GRANTED);
    expect(a.enabled).toBe(false);
    a.track("sign_up", { method: "email" });
    a.identify("u-1");
    expect(a.emitted).toEqual([{ event: "sign_up", props: { method: "email" } }]);
  });

  it("builds a GTM sink only for a container id and a PostHog sink only for a key", () => {
    expect(isValidGtmId("GTM-ABC123")).toBe(true);
    expect(isValidGtmId("G-12345")).toBe(false);
    expect(sinksFromEnv({ VITE_GTM_ID: "GTM-ABC123" }).map((s) => s.name)).toEqual(["gtm"]);
    expect(sinksFromEnv({ VITE_POSTHOG_KEY: "phc_x" }).map((s) => s.name)).toEqual(["posthog"]);
    expect(sinksFromEnv({ VITE_GTM_ID: "GTM-ABC123", VITE_POSTHOG_KEY: "phc_x" }).map((s) => s.name)).toEqual([
      "gtm",
      "posthog",
    ]);
  });

  it("fans one sanitized event out to every sink and starts them once, on consent", () => {
    const a = createAnalytics(() => {});
    const s1 = recordingSink("a");
    const s2 = recordingSink("b");
    a.init([s1, s2]);
    expect(s1.started).toBe(0);
    a.setConsent(GRANTED);
    expect(s1.started).toBe(1);
    a.track("channel_connected", { channel: "naver" });
    a.track("today_inbox_viewed");
    a.identify(null); // initial "no user yet" — not a change, nothing to tell a sink
    a.identify("user-uuid");
    a.identify("user-uuid"); // re-render, same identity
    a.identify(null);
    expect(s1.started).toBe(1);
    expect(s2.calls).toEqual([
      ["track", "channel_connected", { channel: "naver" }],
      ["track", "today_inbox_viewed", {}],
      ["identify", "user-uuid"],
      ["identify", null],
    ]);
  });

  it("drops every non-allow-listed key and every non-enum value before any sink sees it", () => {
    const warn = vi.fn();
    const a = createAnalytics(warn);
    const s = recordingSink();
    a.init([s]);
    a.setConsent(GRANTED);
    a.track("sign_up", {
      method: "email",
      // everything below is what the contract forbids — none of it may leave the abstraction
      email: "seller@example.com",
      name: "홍길동",
      orgName: "우리 스토어",
      reviewText: "배송이 늦어요",
      accountId: "3f1c…",
    } as never);
    a.track("channel_connected", { channel: "SmartStore-account-42" } as never);
    a.track("login", { method: "kakao" } as never);
    expect(s.calls).toEqual([
      ["track", "sign_up", { method: "email" }],
      ["track", "channel_connected", {}],
      ["track", "login", {}],
    ]);
    expect(JSON.stringify(s.calls)).not.toMatch(/example\.com|홍길동|스토어|배송|3f1c/);
    expect(warn).toHaveBeenCalled();
  });

  it("refuses an event that is not in the vocabulary", () => {
    const warn = vi.fn();
    const a = createAnalytics(warn);
    const s = recordingSink();
    a.init([s]);
    a.setConsent(GRANTED);
    (a as unknown as { track: (e: string) => void }).track("page_view_with_url");
    expect(s.calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown event"));
  });

  it("trackOnce fires the same event+props once per page load", () => {
    const a = createAnalytics(() => {});
    const s = recordingSink();
    a.init([s]);
    a.setConsent(GRANTED);
    a.trackOnce("first_sync_completed", { channel: "coupang" });
    a.trackOnce("first_sync_completed", { channel: "coupang" });
    a.trackOnce("first_sync_completed", { channel: "naver" });
    expect(s.calls).toHaveLength(2);
  });

  it("a sink that throws never reaches product code", () => {
    const a = createAnalytics(() => {});
    a.init([
      {
        name: "broken",
        start() {
          throw new Error("vendor down");
        },
        track() {
          throw new Error("vendor down");
        },
        identify() {
          throw new Error("vendor down");
        },
      },
    ]);
    a.setConsent(GRANTED);
    expect(() => {
      a.track("inquiry_opened");
      a.identify("u");
    }).not.toThrow();
  });

  it("sanitize + channel mapping are total over the vocabulary", () => {
    for (const event of ANALYTICS_EVENT_NAMES) {
      expect(sanitize(event, { junk: "x" }).props).toEqual({});
    }
    expect(analyticsChannel("NAVER")).toBe("naver");
    expect(analyticsChannel("Cafe24")).toBe("cafe24");
    expect(analyticsChannel("ESM")).toBeNull();
    expect(analyticsChannel(undefined)).toBeNull();
  });
});

describe("analytics — consent (docs/service_readiness_v1.md §2-4)", () => {
  it("buffers before a decision, then starts the sinks and flushes in order on grant", () => {
    const a = createAnalytics(() => {});
    const s = recordingSink();
    a.init([s]);
    a.identify("uuid-9");
    a.track("sign_up", { method: "email" });
    a.track("onboarding_completed");
    expect(s.started).toBe(0);
    expect(s.calls).toEqual([]);
    expect(a.started).toBe(false);
    a.setConsent({ analytics: true, marketing: true });
    expect(s.started).toBe(1);
    expect(s.calls).toEqual([
      ["identify", "uuid-9"],
      ["track", "sign_up", { method: "email" }],
      ["track", "onboarding_completed", {}],
    ]);
  });

  it("drops the buffer on refusal and never starts a sink; withdrawal after start tells the sink to stop", () => {
    const a = createAnalytics(() => {});
    const s = recordingSink();
    a.init([s]);
    a.track("today_inbox_viewed");
    a.setConsent({ analytics: false, marketing: false });
    a.track("inquiry_opened");
    expect(s.started).toBe(0);
    expect(s.calls).toEqual([]);
    a.setConsent(GRANTED);
    expect(s.started).toBe(1);
    a.setConsent({ analytics: false, marketing: false });
    expect(s.calls).toEqual([["consent", { analytics: false, marketing: false }]]);
    a.track("review_attention_opened");
    expect(s.calls).toHaveLength(1);
    a.setConsent({ analytics: true, marketing: true });
    expect(s.calls[s.calls.length - 1]).toEqual(["consent", { analytics: true, marketing: true }]);
    expect(s.started).toBe(1);
  });

  it("initial consent: not-applicable without vendors, stored decision or pending under the banner policy", () => {
    expect(initialConsent({}, null)).toEqual({ analytics: true, marketing: false });
    expect(initialConsent({ VITE_GTM_ID: "GTM-ABC123" }, null)).toBeNull();
    expect(initialConsent({ VITE_GTM_ID: "GTM-ABC123" }, { version: 1, analytics: true, marketing: false, decidedAt: "" }))
        .toEqual({ analytics: true, marketing: false });
    expect(initialConsent({ VITE_CONSENT_BANNER: "always" }, null)).toBeNull();
  });
});

describe("GTM sink", () => {
  it("pushes gtm.js once on start, then events and the opaque user id onto dataLayer", () => {
    const win = { dataLayer: undefined as unknown[] | undefined, document };
    const sink = createGtmSink("GTM-TEST1", win);
    sink.start!({ analytics: true, marketing: false });
    sink.start!({ analytics: true, marketing: false });
    sink.track("sign_up", { method: "google" });
    sink.identify("uuid-1");
    sink.consent!({ analytics: true, marketing: true });
    const layer = win.dataLayer!;
    // Consent Mode v2: default (all denied) then update, BEFORE gtm.js — as `arguments` objects, the gtag shape.
    const asArgs = (i: number) => Array.from(layer[i] as ArrayLike<unknown>);
    expect(asArgs(0)).toEqual(["consent", "default", {
      analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    }]);
    expect(asArgs(1)).toEqual(["consent", "update", {
      analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    }]);
    expect((layer[2] as { event: string }).event).toBe("gtm.js");
    expect(asArgs(layer.length - 1)).toEqual(["consent", "update", {
      analytics_storage: "granted", ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted",
    }]);
    expect(layer.filter((e) => (e as { event?: string }).event === "gtm.js")).toHaveLength(1);
    expect(layer).toContainEqual({ event: "sign_up", method: "google" });
    expect(layer).toContainEqual({ event: "sellerops_identify", user_id: "uuid-1" });
    expect(document.querySelectorAll('script[src^="https://www.googletagmanager.com/gtm.js?id=GTM-TEST1"]')).toHaveLength(1);
  });
});

describe("PostHog sink", () => {
  it("initialises with session replay, autocapture and pageview OFF, and identifies by opaque id only", () => {
    const calls: unknown[] = [];
    const ph: PosthogLike = {
      init: (k, o) => calls.push(["init", k, o]),
      capture: (e, p) => calls.push(["capture", e, p]),
      identify: (id) => calls.push(["identify", id]),
      reset: () => calls.push(["reset"]),
    };
    const sink = createPosthogSink("phc_key", "https://eu.i.posthog.com/", { posthog: ph, document });
    sink.start!({ analytics: true, marketing: false });
    sink.track("login", { method: "naver" });
    sink.identify("uuid-2");
    sink.identify(null);
    expect(calls[0]).toEqual([
      "init",
      "phc_key",
      { api_host: "https://eu.i.posthog.com", ...POSTHOG_INIT_OPTIONS },
    ]);
    expect(POSTHOG_INIT_OPTIONS.disable_session_recording).toBe(true);
    expect(POSTHOG_INIT_OPTIONS.autocapture).toBe(false);
    expect(calls.slice(1)).toEqual([["capture", "login", { method: "naver" }], ["identify", "uuid-2"], ["reset"]]);
  });

  it("queues calls until the script has loaded", () => {
    const win: { posthog?: PosthogLike; document: Document } = { document };
    const sink = createPosthogSink("phc_key", undefined, win);
    sink.track("today_inbox_viewed", {});
    sink.start!({ analytics: true, marketing: false });
    const script = document.querySelector('script[src="https://us.i.posthog.com/static/array.js"]') as HTMLScriptElement;
    expect(script).not.toBeNull();
    const calls: unknown[] = [];
    win.posthog = {
      init: (k, o) => calls.push(["init", k, o]),
      capture: (e, p) => calls.push(["capture", e, p]),
      identify: () => {},
      reset: () => {},
    };
    script.onload!(new Event("load"));
    expect(calls.map((c) => (c as unknown[])[0])).toEqual(["init", "capture"]);
  });
});
