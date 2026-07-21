/**
 * Binding and REBINDING the composite seller-center session identity.
 *
 * Two distinct operator questions, deliberately not one:
 *  - **first-time bind** — "this session is the shop this task belongs to";
 *  - **rebind** — "the shop was renamed, and it is still the same shop".
 * They are different intents with different evidence, so they take different
 * confirmations. An operator who answered the first has not answered the second, and
 * spending one confirmation on the other is how a wrong binding gets written while
 * everyone believes it was approved.
 *
 * NOTHING IS OVERWRITTEN SILENTLY. A connection that already carries a session
 * identity is refused unless `intent` is explicitly `"rebind"`, and a rebind is
 * refused unless the operator confirmed a rebind specifically.
 *
 * Pure — no fs, no browser, no network, no clock, no randomness. The caller supplies
 * `now`, which keeps this deterministic under test.
 */

import { bindConnectionToSessionIdentity } from "../../connection/connection";
import type { CollectorConnection } from "../../connection/types";
import type { AccountFingerprintRawSignals } from "../../naver/account-fingerprint-adapter";
import {
  compositeSessionFingerprint,
  normalizeSessionIdentity,
} from "./session-chrome-identity";

export type ChromeBindIntent = "first-time" | "rebind";

/** Fixed refusal categories. Never carry a raw value. */
export type ChromeBindRefusal =
  | "operator-did-not-confirm"
  | "not-logged-in"
  | "seller-shell-unconfirmed"
  | "identity-unreadable"
  | "already-bound"
  | "not-a-rebind-candidate";

export type ChromeBindOutcome =
  | {
      ok: true;
      connection: CollectorConnection;
      intent: ChromeBindIntent;
      /** The shop name now stored. Non-sensitive; it is the shop's public name. */
      shopDisplayName: string;
      /** Present only on a rebind — what the label used to be. */
      previousShopDisplayName: string | null;
    }
  | { ok: false; reason: ChromeBindRefusal };

export interface BindChromeIdentityInput {
  connection: CollectorConnection;
  /** Raw values read from the two pinned chrome containers this run. */
  observedUserId: string | null;
  observedShopName: string | null;
  /** Which question the operator was actually asked. */
  intent: ChromeBindIntent;
  /** The operator's answer to THAT question. */
  operatorConfirmed: boolean;
  /** The same session gates the verifier applies — a bind must not outrun them. */
  signals: AccountFingerprintRawSignals;
  /** Digest of the selector specs the values were read through. Bound alongside them. */
  selectorSpecFingerprint: string;
  /** ISO timestamp, supplied for deterministic output. */
  now: string;
}

/**
 * Produce the connection to persist, or a refusal. Every refusal path binds nothing:
 * no digest is computed into the record and the caller has nothing to save.
 */
export function bindSessionChromeIdentity(input: BindChromeIdentityInput): ChromeBindOutcome {
  // Checked first and unconditionally: no amount of good evidence substitutes for the
  // operator answering the question they were actually asked.
  if (!input.operatorConfirmed) {
    return { ok: false, reason: "operator-did-not-confirm" };
  }

  // A binding is permanent and there is no unbind path, so the session gates apply here
  // exactly as they do at verification time.
  if (!input.signals.loggedInSignal || input.signals.urlCategory !== "seller-center") {
    return { ok: false, reason: "not-logged-in" };
  }
  if (!input.signals.sellerShellSignal) {
    return { ok: false, reason: "seller-shell-unconfirmed" };
  }

  const identity = normalizeSessionIdentity(input.observedUserId, input.observedShopName);
  if (identity === null) {
    // Either field missing or malformed. There is no partial bind.
    return { ok: false, reason: "identity-unreadable" };
  }

  const alreadyBound = input.connection.boundSessionIdentityFingerprint !== null;
  if (input.intent === "first-time" && alreadyBound) {
    return { ok: false, reason: "already-bound" };
  }
  if (input.intent === "rebind" && !alreadyBound) {
    // Nothing to rebind. Treating this as a first-time bind would accept a rebind
    // confirmation for a question the operator was never asked.
    return { ok: false, reason: "not-a-rebind-candidate" };
  }

  const fingerprint = compositeSessionFingerprint(identity.userId, identity.shopName);
  if (fingerprint === null) {
    return { ok: false, reason: "identity-unreadable" };
  }

  return {
    ok: true,
    connection: bindConnectionToSessionIdentity(
      input.connection,
      fingerprint,
      identity.shopName,
      input.selectorSpecFingerprint,
      input.now,
    ),
    intent: input.intent,
    shopDisplayName: identity.shopName,
    previousShopDisplayName:
      input.intent === "rebind" ? input.connection.boundShopDisplayName : null,
  };
}
