import type { AnalyticsEventName } from "./events";
import type { AnalyticsSink } from "./sink";

/**
 * Google Tag Manager sink — the one place `dataLayer` is touched. GA4 (and later Google Ads / Meta / NAVER
 * conversion tags) are configured INSIDE the container on these event names; the app never loads gtag or an ad
 * SDK itself (docs/auth_growth_instrumentation_v1.md §3, §7).
 */
export interface GtmWindow {
  dataLayer?: unknown[];
  document?: Document;
}

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]{4,10}$/;

export function isValidGtmId(id: string | undefined | null): id is string {
  return typeof id === "string" && GTM_ID_PATTERN.test(id);
}

export function createGtmSink(containerId: string, win: GtmWindow = window as unknown as GtmWindow): AnalyticsSink {
  let started = false;
  const layer = (): unknown[] => (win.dataLayer ??= []);
  return {
    name: "gtm",
    start() {
      if (started) return;
      started = true;
      layer().push({ "gtm.start": Date.now(), event: "gtm.js" });
      const doc = win.document;
      if (!doc) return;
      const script = doc.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
      doc.head.appendChild(script);
    },
    track(event: AnalyticsEventName, props: Record<string, string>) {
      layer().push({ event, ...props });
    },
    identify(userId) {
      // GA4 `user_id` (opaque UUID) is read from the dataLayer by the container's GA4 config tag.
      layer().push({ event: "sellerops_identify", user_id: userId ?? undefined });
    },
  };
}
