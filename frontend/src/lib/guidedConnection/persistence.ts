// NAVER Guided Connection (G3) — refresh-resume persistence (secret-free).
//
// A hard browser refresh drops the in-memory reducer state, so a seller mid-journey would be
// bounced back to the start. This module persists ONLY the sanitized, resumable slice of the
// journey — `phase` + `milestones` + `path` — and restores it on mount. It NEVER stores a Client
// Secret, an account id, a selector, or a url: the guided-journey state carries none by design
// (see state.ts), and this module copies only those three primitive fields.
//
// Restore policy (fail-closed):
//   • Pre-registration USER-DECISION phases (path choice, issuance walk, credential entry, secret
//     recovery) are restored verbatim: they wait for the seller's input, carry no secret, and
//     re-doing them is exactly the friction we remove. Restoring them cannot strand a spinner.
//   • Anything else — the automated phases (registration/test/sync), the terminals, and drift — is
//     NOT restored. We return INITIAL_STATE so the page's own
//     saved-credential re-check drives recovery from the backend (a stored key jumps straight to
//     the connection test with no re-entry), which is the honest, self-driving path and never a
//     non-running spinner or a falsely-claimed completion.
import { actorFor, INITIAL_STATE } from "./state";
import type { GuidedConnectionState, GuidedMilestones, GuidedPath, GuidedPhase } from "./types";

const STORAGE_KEY = "naver_guided_connection_v1";

const NO_MILESTONES: GuidedMilestones = { registered: false, tested: false, synced: false };

/** Pre-registration, seller-input phases that are safe to restore verbatim after a refresh. */
const RESTORABLE_PHASES: ReadonlySet<GuidedPhase> = new Set<GuidedPhase>([
  "application_path_choice",
  "application_status_unknown",
  "account_store_choice_required",
  "application_issuance",
  "credential_issued",
  "sellerops_credential_entry",
  "existing_credential_entry",
  "credential_recovery_required",
]);

const VALID_PATHS: ReadonlySet<string> = new Set<GuidedPath>(["unknown", "saved", "new", "existing"]);

interface PersistedProgress {
  phase: GuidedPhase;
  path: GuidedPath;
}

/** Persist the resumable slice. Called on every state change; only phase/path leave the reducer. */
export function saveGuidedProgress(state: GuidedConnectionState): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ phase: state.phase, path: state.path }));
  } catch {
    // Storage unavailable (private mode / quota) — resume is best-effort, never fatal.
  }
}

/** Remove the persisted slice (journey reset, or completion consumed by navigating away). */
export function clearGuidedProgress(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readPersisted(): PersistedProgress | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedProgress>;
    if (!parsed.phase || !RESTORABLE_PHASES.has(parsed.phase as GuidedPhase)) return null;
    const path: GuidedPath = VALID_PATHS.has(parsed.path as string) ? (parsed.path as GuidedPath) : "unknown";
    return { phase: parsed.phase as GuidedPhase, path };
  } catch {
    return null;
  }
}

/**
 * Lazy `useReducer` initializer: restore a safe pre-registration phase from sessionStorage, else the
 * normal INITIAL_STATE (which lets the backend saved-credential re-check drive recovery). Restored
 * state always has cleared milestones (these phases are pre-registration) and no failure — nothing here
 * can claim progress the seller has not actually made.
 */
export function loadGuidedInitialState(): GuidedConnectionState {
  const persisted = readPersisted();
  if (!persisted) return INITIAL_STATE;
  return {
    phase: persisted.phase,
    actor: actorFor(persisted.phase),
    failureReason: null,
    milestones: NO_MILESTONES,
    path: persisted.path,
  };
}
