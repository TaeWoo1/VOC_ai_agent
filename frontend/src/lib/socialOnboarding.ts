import type { AuthMethod } from "./analytics";

/**
 * The pending social onboarding — what `/auth/callback` got back for a first-time Google/NAVER identity and
 * `/onboarding` spends. Kept in sessionStorage (this tab, until closed), never in a URL. The token is a
 * one-time backend handoff (30 min); the email/name are the person's own, shown back to them as prefill.
 */
export interface PendingSocialOnboarding {
  onboardingToken: string;
  provider: string;
  email: string | null;
  name: string | null;
}

const KEY = "sellerops_social_onboarding";

export function savePendingOnboarding(p: PendingSocialOnboarding): void {
  sessionStorage.setItem(KEY, JSON.stringify(p));
}

export function readPendingOnboarding(): PendingSocialOnboarding | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingSocialOnboarding>;
    if (typeof parsed.onboardingToken !== "string" || typeof parsed.provider !== "string") return null;
    return {
      onboardingToken: parsed.onboardingToken,
      provider: parsed.provider,
      email: typeof parsed.email === "string" ? parsed.email : null,
      name: typeof parsed.name === "string" ? parsed.name : null,
    };
  } catch {
    return null;
  }
}

export function clearPendingOnboarding(): void {
  sessionStorage.removeItem(KEY);
}

/** Provider id → analytics `method` (the only place a provider string is turned into an event prop). */
export function authMethodOf(provider: string): AuthMethod | null {
  return provider === "google" || provider === "naver" ? provider : null;
}

export const PROVIDER_LABEL: Record<string, string> = { google: "Google", naver: "네이버" };
