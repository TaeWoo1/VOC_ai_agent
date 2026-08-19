import type { AnalyticsEventName } from "./events";
import type { AnalyticsSink, ConsentGrant } from "./sink";

/**
 * Google Tag Manager sink — the one place `dataLayer` is touched. GA4 (and later Google Ads / Meta / NAVER
 * conversion tags) are configured INSIDE the container on these event names; the app never loads gtag or an ad
 * SDK itself (docs/auth_growth_instrumentation_v1.md §3, §7).
 *
 * Consent Mode v2 (docs/service_readiness_v1.md §2-4): before `gtm.js` a `consent default` with everything
 * denied, then `consent update` from the visitor's grant (분석 → analytics_storage; 마케팅 → ad_storage,
 * ad_user_data, ad_personalization) — and again on every later change. `gtag` here is the standard shim
 * (`dataLayer.push(arguments)`), the only form the container reads consent commands in.
 */
export interface GtmWindow {
  dataLayer?: unknown[];
  document?: Document;
}

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]{4,10}$/;

export function isValidGtmId(id: string | undefined | null): id is string {
  return typeof id === "string" && GTM_ID_PATTERN.test(id);
}

export function consentModeParams(grant: ConsentGrant): Record<string, "granted" | "denied"> {
  const analytics = grant.analytics ? "granted" : "denied";
  const ads = grant.marketing ? "granted" : "denied";
  return {
    analytics_storage: analytics,
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
  };
}

const CONSENT_DEFAULT: Record<string, "granted" | "denied"> = consentModeParams({ analytics: false, marketing: false });

export function createGtmSink(containerId: string, win: GtmWindow = window as unknown as GtmWindow): AnalyticsSink {
  let started = false;
  const layer = (): unknown[] => (win.dataLayer ??= []);
  // GTM reads consent commands as pushed `arguments` objects (what the documented `gtag` shim produces),
  // not as plain objects — so build exactly that.
  function gtag(..._args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    layer().push(arguments);
  }
  const consentCommand = (command: "default" | "update", params: Record<string, string>) =>
    gtag("consent", command, params);
  return {
    name: "gtm",
    start(grant) {
      if (started) return;
      started = true;
      consentCommand("default", CONSENT_DEFAULT);
      consentCommand("update", consentModeParams(grant));
      layer().push({ "gtm.start": Date.now(), event: "gtm.js" });
      const doc = win.document;
      if (!doc) return;
      const script = doc.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
      doc.head.appendChild(script);
    },
    consent(grant) {
      consentCommand("update", consentModeParams(grant));
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
