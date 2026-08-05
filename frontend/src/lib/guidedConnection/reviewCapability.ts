// NAVER Guided Connection (G3) — REVIEW_IMPORT capability overlay (Local-Agent-aware, review-only).
//
// The backend capability result is Local-Agent-blind (it reads only persisted backend state — see the
// ConnectionCapabilityService). Whether the Local Agent is set up is a client-side runtime fact, and it
// matters ONLY for REVIEW_IMPORT (reviews are gathered through the agent-hosted Action Window guided
// export). So the FE overlays the pairing state onto the REVIEW_IMPORT line and NOTHING else:
//   • Local Agent paired    → GUIDED_CONFIRMATION  (ready to run the guided export)
//   • Local Agent not paired → SETUP_REQUIRED      (do the review-import setup first)
// Order read / review reply / inquiry lines pass through untouched — the bridge never affects the order
// connection. Pure & DOM-free so it is unit-tested offline.
import type { ConnectionCapabilityFeatureView, ConnectionCapabilityView } from "../types";

export const REVIEW_IMPORT_FEATURE = "REVIEW_IMPORT";
export const CAP_SETUP_REQUIRED = "SETUP_REQUIRED";
export const CAP_GUIDED_CONFIRMATION = "GUIDED_CONFIRMATION";
export const REASON_REVIEW_SETUP_REQUIRED = "REVIEW_SETUP_REQUIRED";
export const REASON_GUIDED_EXPORT_ONLY = "GUIDED_EXPORT_ONLY";

/** The review-import states the overlay is allowed to rewrite. A non-guided review-import state (e.g. a
 *  future NEEDS_ATTENTION) is left as the backend reported it — the overlay only toggles setup vs ready. */
const OVERLAYABLE_STATES: ReadonlySet<string> = new Set([CAP_SETUP_REQUIRED, CAP_GUIDED_CONFIRMATION]);

/**
 * Return a copy of the capability view with the REVIEW_IMPORT line reflecting Local-Agent pairing. Every
 * other feature (and every other field) is unchanged. If there is no REVIEW_IMPORT line, or its state is
 * not an overlayable guided state, the view is returned as-is.
 */
export function overlayReviewImport(
  capability: ConnectionCapabilityView,
  agentPaired: boolean,
): ConnectionCapabilityView {
  let changed = false;
  const features = capability.features.map((f): ConnectionCapabilityFeatureView => {
    if (f.feature !== REVIEW_IMPORT_FEATURE || !OVERLAYABLE_STATES.has(f.state)) return f;
    changed = true;
    return {
      ...f,
      state: agentPaired ? CAP_GUIDED_CONFIRMATION : CAP_SETUP_REQUIRED,
      reason: agentPaired ? REASON_GUIDED_EXPORT_ONLY : REASON_REVIEW_SETUP_REQUIRED,
    };
  });
  return changed ? { ...capability, features } : capability;
}

/**
 * Does review import still need Local-Agent setup? True when the REVIEW_IMPORT line is present, guided,
 * and the agent is not paired. Drives the post-completion setup card copy without touching order state.
 */
export function reviewImportNeedsSetup(capability: ConnectionCapabilityView, agentPaired: boolean): boolean {
  if (agentPaired) return false;
  return capability.features.some(
    (f) => f.feature === REVIEW_IMPORT_FEATURE && OVERLAYABLE_STATES.has(f.state),
  );
}
