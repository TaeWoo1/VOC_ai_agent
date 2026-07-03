/**
 * **Local Agent login-mode binding** metadata + store (M-Agent-1C1).
 *
 * Per-connection, NON-SECRET login-mode identity for the device-local reconnect:
 * which marketplace login surface the seller uses (`loginMode`), a one-way salted
 * fingerprint of the approved mode selector's sanitized shape (`loginModeSignature`),
 * a one-way salted fingerprint of the expected POST-mode-click login-form shape
 * (`postModeFormSignature`), and the probe-derived `reconnectInteractionCategory`
 * (M-Agent-1B established `TWO_STEP_FIELD_AND_CREDENTIAL_SELECTION` for GMARKET).
 *
 * **Privacy invariant (hard):** NEVER stores a candidate index-as-identity, raw
 * label, selector, DOM text, URL, username, password, cookie, token, or marketplace
 * id. Only booleans / coarse buckets / one-way salted hashes / small enums.
 *
 * M-Agent-1C1 ships the binding TYPE + an abstract STORE interface + an IN-MEMORY
 * adapter ONLY — no DB, no filesystem, no `.status` write (deferred, separate slice).
 */

import { createHash } from "node:crypto";
import {
  computeCandidateSignature,
  CANDIDATE_SIGNATURE_SCHEMA_VERSION,
  type CandidateScope,
  type CandidateShape,
  type LabelTokenBucket,
} from "../esm/esm-candidate-signature";
import type {
  LocalAgentConnection,
  LoginMode,
  ReconnectInteractionCategory,
  SanitizedAccountRef,
} from "./local-agent-state";

/** Bump on any change to the form-shape serialization/algorithm below. */
export const LOCAL_AGENT_FORM_SIGNATURE_VERSION = 1;

/** Coarse size bucket of the login-mode selector (never pixel dimensions). */
export type ModeRectBucket = "small" | "medium" | "large";

/**
 * A SANITIZED login-mode candidate descriptor. Carries only coarse category/booleans
 * — NEVER a raw label, selector, DOM text, URL, or a durable index. `token` is a
 * diagnostic-session-local opaque click handle, NOT identity, and is never stored.
 */
export interface SanitizedModeCandidate {
  modeCategory: LoginMode | "OTHER";
  interactiveCategory: "tab" | "link" | "button" | "other";
  visible: boolean;
  enabled: boolean;
  topFrame: boolean;
  rectBucket: ModeRectBucket;
}

/**
 * A SANITIZED login-form shape (post-mode-click). Coarse field-count buckets +
 * booleans only — never field values, labels, selectors, or DOM text.
 */
export interface SanitizedFormShape {
  idFieldBucket: "zero" | "one" | "many";
  pwFieldBucket: "zero" | "one" | "many";
  submitBucket: "zero" | "one" | "many";
  formPresent: boolean;
  gmarketTabActive: boolean;
  challengePresent: boolean;
}

/**
 * The persisted per-connection login-mode binding. Hash-only identity; no index,
 * no raw text. `postModeFormSignature` is null until first captured during a
 * supervised reconnect.
 */
export interface LoginModeBinding {
  account: SanitizedAccountRef;
  loginMode: LoginMode;
  loginModeSignatureVersion: number;
  loginModeSignature: string;
  postModeFormSignature: string | null;
  reconnectInteractionCategory: ReconnectInteractionCategory;
}

/** Map a sanitized mode candidate to the `CandidateShape` its signature is computed over. */
export function modeCandidateShape(candidate: SanitizedModeCandidate): CandidateShape {
  const tokenCountBucket: LabelTokenBucket =
    candidate.rectBucket === "small" ? "one" : candidate.rectBucket === "medium" ? "few" : "many";
  const scope: CandidateScope = candidate.topFrame ? "top-document" : "same-origin-frame";
  return {
    category: "other", // a login-mode selector is not an export/consent control
    actionable: candidate.enabled,
    scope,
    labelShape: { tokenCountBucket, script: "other", hasExportWord: false },
  };
}

/** The versioned, salted login-mode signature (reuses the export candidate-signature primitive). */
export function computeLoginModeSignature(candidate: SanitizedModeCandidate, salt: string): string {
  return computeCandidateSignature(modeCandidateShape(candidate), salt);
}

/** True when a live mode candidate's signature exactly matches the binding (version + hash). */
export function loginModeSignatureMatches(
  binding: Pick<LoginModeBinding, "loginModeSignatureVersion" | "loginModeSignature">,
  liveCandidate: SanitizedModeCandidate,
  salt: string,
): boolean {
  if (binding.loginModeSignatureVersion !== CANDIDATE_SIGNATURE_SCHEMA_VERSION) return false;
  return binding.loginModeSignature === computeLoginModeSignature(liveCandidate, salt);
}

/** A versioned, salted one-way fingerprint of the sanitized post-mode login-form shape. */
export function computeFormSignature(shape: SanitizedFormShape, salt: string): string {
  if (salt.length === 0) {
    throw new Error("computeFormSignature: a non-empty salt is required (fail-closed)");
  }
  const parts: readonly (string | number | boolean)[] = [
    LOCAL_AGENT_FORM_SIGNATURE_VERSION,
    shape.idFieldBucket,
    shape.pwFieldBucket,
    shape.submitBucket,
    shape.formPresent,
    shape.gmarketTabActive,
    shape.challengePresent,
  ];
  return createHash("sha256").update(`${salt} ${JSON.stringify(parts)}`).digest("hex").slice(0, 16);
}

/**
 * Build the 1A `LocalAgentConnection` the runtime consumes from a binding + the
 * (separately-granted) consent set. Keeps the runtime's signature gate consistent
 * with the binding: `loginModeSignature` is copied verbatim.
 */
export interface LocalAgentConsents {
  sessionInspectionConsent: boolean;
  loginModeAutoSelectionConsent: boolean;
  assistedReconnectConsent: boolean;
  autoSubmitAfterCredentialSelectionConsent: boolean;
  reviewExportConsent: boolean;
  uploadConsent: boolean;
}

export function connectionFromBinding(binding: LoginModeBinding, consents: LocalAgentConsents): LocalAgentConnection {
  return {
    account: binding.account,
    loginMode: binding.loginMode,
    loginModeSignatureVersion: binding.loginModeSignatureVersion,
    loginModeSignature: binding.loginModeSignature,
    ...consents,
  };
}

// ── Abstract store + in-memory adapter (NO real persistence in 1C1) ────────────────────────────────

/** Abstract, account-scoped login-mode binding store. In-memory adapter only in 1C1. */
export interface LoginModeBindingStore {
  load(account: SanitizedAccountRef): Promise<LoginModeBinding | null>;
  save(binding: LoginModeBinding): Promise<void>;
}

/** In-memory, account-scoped adapter (tests + the offline adapter). No DB/fs/encryption. */
export class InMemoryLoginModeBindingStore implements LoginModeBindingStore {
  private readonly byAccount = new Map<string, LoginModeBinding>();

  async load(account: SanitizedAccountRef): Promise<LoginModeBinding | null> {
    return this.byAccount.get(account.connectionId) ?? null;
  }

  async save(binding: LoginModeBinding): Promise<void> {
    this.byAccount.set(binding.account.connectionId, binding);
  }
}
