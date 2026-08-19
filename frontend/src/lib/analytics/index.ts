import { createAnalytics } from "./analytics";
import { createGtmSink, isValidGtmId } from "./gtmSink";
import { createPosthogSink, POSTHOG_DEFAULT_HOST } from "./posthogSink";
import type { AnalyticsSink, ConsentGrant } from "./sink";
import { consentPolicy, readConsent, type ConsentEnv } from "../consent/consent";

export type { AnalyticsEventName, AnalyticsEvents, AuthMethod, AnalyticsChannel } from "./events";
export { analyticsChannel } from "./events";
export type { Analytics } from "./analytics";
export type { ConsentGrant } from "./sink";

/** The app-wide instance. `main.tsx` calls `initAnalyticsFromEnv()` once; everything else calls `analytics.track`. */
export const analytics = createAnalytics();

export interface AnalyticsEnv extends ConsentEnv {
  VITE_GTM_ID?: string;
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
}

/**
 * Sinks from env — GTM when `VITE_GTM_ID` is a container id, PostHog when `VITE_POSTHOG_KEY` is set. Both absent
 * (the local/dev default) → no sinks → OFF. Nothing else can turn a vendor on.
 */
export function sinksFromEnv(env: AnalyticsEnv): AnalyticsSink[] {
  const sinks: AnalyticsSink[] = [];
  const gtm = env.VITE_GTM_ID?.trim();
  if (isValidGtmId(gtm)) sinks.push(createGtmSink(gtm));
  const phKey = env.VITE_POSTHOG_KEY?.trim();
  if (phKey) sinks.push(createPosthogSink(phKey, env.VITE_POSTHOG_HOST?.trim() || POSTHOG_DEFAULT_HOST));
  return sinks;
}

/**
 * The consent the analytics layer starts with (docs/service_readiness_v1.md §2-4): under the banner policy the
 * stored decision (or none yet → buffer); with no vendor configured there is nothing to consent to and the layer
 * is simply "allowed" (it has no sinks anyway).
 */
export function initialConsent(env: ConsentEnv, stored = readConsent()): ConsentGrant | null {
  if (consentPolicy(env) === "not-applicable") return { analytics: true, marketing: false };
  return stored ? { analytics: stored.analytics, marketing: stored.marketing } : null;
}

export function initAnalyticsFromEnv(env: AnalyticsEnv = import.meta.env as unknown as AnalyticsEnv): void {
  analytics.init(sinksFromEnv(env));
  // Eager start (once allowed): GTM must be on the LANDING page for the landing page_view — the UTM carrier of
  // the whole funnel — not on the first tracked event (docs/service_readiness_v1.md §1, §8).
  analytics.setConsent(initialConsent(env));
}
