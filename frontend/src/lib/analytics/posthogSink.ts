import type { AnalyticsEventName } from "./events";
import type { AnalyticsSink } from "./sink";

/**
 * PostHog sink (product funnel / retention) — optional, same abstraction. Loaded from the PostHog host's own
 * `array.js` when a key is present; **session replay OFF**, autocapture OFF, automatic pageview OFF, so
 * exactly the events in `events.ts` (and nothing typed on a page) leave the browser
 * (docs/auth_growth_instrumentation_v1.md §2-8).
 */
export interface PosthogLike {
  init(key: string, options: Record<string, unknown>): void;
  capture(event: string, props?: Record<string, unknown>): void;
  identify(id: string): void;
  reset(): void;
  opt_in_capturing?(): void;
  opt_out_capturing?(): void;
}

export interface PosthogWindow {
  posthog?: PosthogLike;
  document?: Document;
}

export const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

export const POSTHOG_INIT_OPTIONS = Object.freeze({
  disable_session_recording: true,
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  persistence: "localStorage+cookie",
});

/**
 * Loads the snippet lazily. Until `array.js` arrives, calls are queued the way PostHog's own snippet does it
 * (a stub whose methods push onto `posthog._i` … simplified: we queue closures and flush on load).
 */
export function createPosthogSink(
  key: string,
  host: string = POSTHOG_DEFAULT_HOST,
  win: PosthogWindow = window as unknown as PosthogWindow,
): AnalyticsSink {
  let started = false;
  const queue: Array<(ph: PosthogLike) => void> = [];
  const apiHost = host.replace(/\/$/, "");

  const withPosthog = (fn: (ph: PosthogLike) => void) => {
    const ph = win.posthog;
    if (ph) fn(ph);
    else queue.push(fn);
  };

  return {
    name: "posthog",
    start() {
      if (started) return;
      started = true;
      if (win.posthog) {
        win.posthog.init(key, { api_host: apiHost, ...POSTHOG_INIT_OPTIONS });
        return;
      }
      const doc = win.document;
      if (!doc) return;
      const script = doc.createElement("script");
      script.async = true;
      script.src = `${apiHost}/static/array.js`;
      script.onload = () => {
        const ph = win.posthog;
        if (!ph) return;
        ph.init(key, { api_host: apiHost, ...POSTHOG_INIT_OPTIONS });
        for (const fn of queue.splice(0)) fn(ph);
      };
      doc.head.appendChild(script);
    },
    // 분석 consent withdrawn/regranted after start (docs/service_readiness_v1.md §2-4). Loaded only after grant.
    consent(grant) {
      withPosthog((ph) => (grant.analytics ? ph.opt_in_capturing?.() : ph.opt_out_capturing?.()));
    },
    track(event: AnalyticsEventName, props: Record<string, string>) {
      withPosthog((ph) => ph.capture(event, props));
    },
    identify(userId) {
      withPosthog((ph) => (userId ? ph.identify(userId) : ph.reset()));
    },
  };
}
