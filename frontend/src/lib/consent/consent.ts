/**
 * Browser consent state — docs/service_readiness_v1.md §2-4. Categories: 필수 (always on, not stored), 분석
 * (analytics vendors: GTM/GA4, PostHog), 마케팅 (ad-related storage — Consent Mode `ad_*`; no ad tag exists yet).
 * Pure functions over `localStorage`; the React side is `ConsentProvider`.
 *
 * Dev policy: with no analytics vendor configured there is nothing to consent to — the banner does not exist and
 * the policy is `not-applicable`. `VITE_CONSENT_BANNER=always` forces the banner (UI review).
 */
import { isValidGtmId } from "../analytics/gtmSink";

export const CONSENT_KEY = "sellerops_consent_v1";
export const CONSENT_VERSION = 1;

export interface ConsentDecision {
  version: number;
  analytics: boolean;
  marketing: boolean;
  decidedAt: string;
}

export type ConsentPolicy = "banner" | "not-applicable";

export interface ConsentEnv {
  VITE_GTM_ID?: string;
  VITE_POSTHOG_KEY?: string;
  VITE_CONSENT_BANNER?: string;
}

export function consentPolicy(env: ConsentEnv): ConsentPolicy {
  if (env.VITE_CONSENT_BANNER?.trim() === "always") return "banner";
  // The same validity rule as `sinksFromEnv`: a malformed GTM id builds no sink, so it asks for no consent.
  return isValidGtmId(env.VITE_GTM_ID?.trim()) || env.VITE_POSTHOG_KEY?.trim() ? "banner" : "not-applicable";
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readConsent(store: StorageLike | null = storage()): ConsentDecision | null {
  const raw = store?.getItem(CONSENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentDecision>;
    if (parsed.version !== CONSENT_VERSION) return null;
    return {
      version: CONSENT_VERSION,
      analytics: parsed.analytics === true,
      marketing: parsed.marketing === true,
      decidedAt: typeof parsed.decidedAt === "string" ? parsed.decidedAt : "",
    };
  } catch {
    return null;
  }
}

export function writeConsent(
  choice: { analytics: boolean; marketing: boolean },
  store: StorageLike | null = storage(),
  now: Date = new Date(),
): ConsentDecision {
  const decision: ConsentDecision = { version: CONSENT_VERSION, ...choice, decidedAt: now.toISOString() };
  store?.setItem(CONSENT_KEY, JSON.stringify(decision));
  return decision;
}

export function clearConsent(store: StorageLike | null = storage()): void {
  store?.removeItem(CONSENT_KEY);
}
