import { createAnalytics } from "./analytics";
import { createGtmSink, isValidGtmId } from "./gtmSink";
import { createPosthogSink, POSTHOG_DEFAULT_HOST } from "./posthogSink";
import type { AnalyticsSink } from "./sink";

export type { AnalyticsEventName, AnalyticsEvents, AuthMethod, AnalyticsChannel } from "./events";
export { analyticsChannel } from "./events";
export type { Analytics } from "./analytics";

/** The app-wide instance. `main.tsx` calls `initAnalyticsFromEnv()` once; everything else calls `analytics.track`. */
export const analytics = createAnalytics();

export interface AnalyticsEnv {
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

export function initAnalyticsFromEnv(env: AnalyticsEnv = import.meta.env as unknown as AnalyticsEnv): void {
  analytics.init(sinksFromEnv(env));
}
