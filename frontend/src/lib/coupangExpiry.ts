// Coupang credential-expiry — pure presentation helpers (no React, no api, no I/O).
//
// The backend COMPUTES the expiry state (from token_expires_at vs a reference `now` + an auth-failure
// signal) and exposes it as `ConnectionStatusView.expiry`. This module only maps that sanitized state to
// FE-owned Korean label + tone, and answers two boolean questions the surfaces ask ("does this need
// attention?" / "is renewal recommended?"). It NEVER estimates a date and NEVER derives the state itself —
// the state is authoritative; UNKNOWN stays UNKNOWN (offer the operator-confirm path, never a guess).

import type { CoupangExpiryState, CoupangExpiryStatusView } from "./types";

/** Tone bucket for an expiry state — drives the chip colour on every surface (FE-owned, four+unknown). */
export type ExpiryTone = "ok" | "warn" | "attention" | "expired" | "unknown";

export interface ExpiryStateView {
  label: string;
  tone: ExpiryTone;
}

// State → { Korean label, tone }. Four operator buckets (OK / 만료 예정 / 조치 필요 / 만료됨) plus the
// honest UNKNOWN ("만료일 미확인"). Every state maps (exhaustive Record → a missing key is a compile error),
// so a new backend state can never silently render blank.
const EXPIRY_STATE_VIEW: Record<CoupangExpiryState, ExpiryStateView> = {
  UNKNOWN: { label: "만료일 미확인", tone: "unknown" },
  OK: { label: "정상", tone: "ok" },
  WARN_30: { label: "만료 예정", tone: "warn" },
  WARN_14: { label: "만료 예정", tone: "warn" },
  WARN_7: { label: "만료 임박", tone: "warn" },
  WARN_1: { label: "만료 임박", tone: "warn" },
  DATE_PASSED: { label: "조치 필요", tone: "attention" },
  EXPIRED: { label: "만료됨", tone: "expired" },
};

/** Map an expiry state to its FE-owned label + tone. Exhaustive; UNKNOWN is a first-class honest state. */
export function expiryStateView(state: CoupangExpiryState): ExpiryStateView {
  return EXPIRY_STATE_VIEW[state];
}

// The states the operational surfaces flag as "만료 예정·조치 필요": every warning bucket plus a passed /
// expired date. OK and UNKNOWN are NOT flagged (UNKNOWN is surfaced separately as "만료일 미확인").
const ATTENTION_STATES: ReadonlySet<CoupangExpiryState> = new Set<CoupangExpiryState>([
  "WARN_30",
  "WARN_14",
  "WARN_7",
  "WARN_1",
  "DATE_PASSED",
  "EXPIRED",
]);

/** True when the operational surfaces should flag this state (WARN_* / DATE_PASSED / EXPIRED). */
export function expiryNeedsAttention(state: CoupangExpiryState): boolean {
  return ATTENTION_STATES.has(state);
}

/** The combined operational-surface summary phrase for an attention state. */
export const EXPIRY_ATTENTION_SUMMARY = "만료 예정·조치 필요";

// Renewal is recommended from WARN_14 onward — the same set the backend flags as `renewRecommended`.
// Kept here as a PURE derivation so the surfaces can decide "show the 갱신 CTA" from the state alone, and
// so it is unit-testable independently of a backend boolean. Surfaces prefer the backend's
// `renewRecommended` when present and fall back to this.
const RENEW_RECOMMENDED_STATES: ReadonlySet<CoupangExpiryState> = new Set<CoupangExpiryState>([
  "WARN_14",
  "WARN_7",
  "WARN_1",
  "DATE_PASSED",
  "EXPIRED",
]);

/** True when renewal should be offered for this state (WARN_14 onward). Pure — mirrors backend intent. */
export function renewRecommendedForState(state: CoupangExpiryState): boolean {
  return RENEW_RECOMMENDED_STATES.has(state);
}

/**
 * Whether the renewal CTA should be offered for an expiry sub-view. Prefers the backend's authoritative
 * `renewRecommended`; if the field is absent (older backend), falls back to the pure state derivation.
 */
export function shouldOfferRenewal(expiry: CoupangExpiryStatusView | null | undefined): boolean {
  if (!expiry) return false;
  if (typeof expiry.renewRecommended === "boolean") return expiry.renewRecommended;
  return renewRecommendedForState(expiry.state);
}

/** Korean day-count detail for the completion screen, or null when unknown. Honest: never fabricated. */
export function daysRemainingLabel(daysRemaining: number | null | undefined): string | null {
  if (daysRemaining == null) return null;
  if (daysRemaining < 0) return `만료일이 ${Math.abs(daysRemaining)}일 지났어요`;
  if (daysRemaining === 0) return "오늘 만료돼요";
  return `약 ${daysRemaining}일 남았어요`;
}
