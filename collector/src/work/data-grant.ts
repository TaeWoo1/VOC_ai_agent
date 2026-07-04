/**
 * **Scoped seller → manufacturer DataGrant** (pure, offline).
 *
 * A `DataGrant` is the seller's explicit, revocable authorization for one manufacturer to READ a scoped
 * slice of the seller's signals. It governs **visibility only** — action authority is a separate axis
 * (`action-authority.ts`): a valid read grant never lets a manufacturer directly perform a seller-channel
 * write. It is the ONLY way a manufacturer sees a seller's data — no grant, no cross-flow. Evaluation is a
 * pure function of the grant, the access request, and a caller-supplied
 * `referenceTimeMs` (the domain never reads a wall clock): a revoked or time-expired grant denies every
 * future read and action.
 *
 * Scope is multi-dimensional: which channels, which products, which signal kinds, and — separately —
 * whether the seller-private order/customer fields are included. Seller-private fields are DENIED by default
 * even under an otherwise-valid grant.
 */

import type { CommerceChannel } from "../connection/sync-state";
import type { SignalKind } from "./types";

/** The scope a grant authorizes. Each axis is checked independently at evaluation time. */
export interface DataGrantScope {
  /** Channels in scope. Empty ⇒ no channel is in scope (a grant must name its channels). */
  channels: readonly CommerceChannel[];
  /** Products in scope: an explicit id list, or `"ALL"` for every product of this seller. */
  productIds: readonly string[] | "ALL";
  /** Signal kinds in scope. Empty ⇒ no kind is in scope. */
  signalKinds: readonly SignalKind[];
  /**
   * Whether the seller-private order/customer fields are shared. Default posture is `false`: a manufacturer
   * never sees order/customer references unless the seller explicitly granted them.
   */
  includeSellerPrivateFields: boolean;
}

/**
 * A seller → manufacturer grant. Validity is (not revoked) AND within `[notBeforeMs, notAfterMs)` evaluated
 * against a caller-supplied reference time; either bound may be null (open-ended on that side).
 */
export interface DataGrant {
  grantId: string;
  sellerId: string;
  manufacturerId: string;
  scope: DataGrantScope;
  /** Explicit revocation — a revoked grant denies immediately, independent of the time bounds. */
  revoked: boolean;
  /** Inclusive lower time bound (epoch ms); null ⇒ no lower bound. */
  notBeforeMs: number | null;
  /** Exclusive upper time bound (epoch ms); at/after this the grant is EXPIRED. Null ⇒ no upper bound. */
  notAfterMs: number | null;
}

/** Why a grant evaluation denied access. */
export type GrantDenyReason =
  | "NO_GRANT"
  | "WRONG_SELLER"
  | "WRONG_MANUFACTURER"
  | "REVOKED"
  | "NOT_YET_VALID"
  | "EXPIRED"
  | "CHANNEL_OUT_OF_SCOPE"
  | "PRODUCT_OUT_OF_SCOPE"
  | "SIGNAL_KIND_OUT_OF_SCOPE"
  | "SELLER_PRIVATE_NOT_GRANTED";

/** The decision: allow, or deny with a sanitized reason. */
export type GrantDecision = { allowed: true } | { allowed: false; reason: GrantDenyReason };

/** What a manufacturer is trying to reach. */
export interface GrantAccessRequest {
  sellerId: string;
  manufacturerId: string;
  channel: CommerceChannel;
  /** The product being reached; null when the access is not product-scoped. */
  productId: string | null;
  signalKind: SignalKind;
  /** Whether the request needs the seller-private order/customer fields. */
  needsSellerPrivateFields: boolean;
}

const deny = (reason: GrantDenyReason): GrantDecision => ({ allowed: false, reason });

/** True iff `referenceTimeMs` falls inside the grant's `[notBeforeMs, notAfterMs)` window. */
function withinValidityWindow(grant: DataGrant, referenceTimeMs: number): GrantDecision {
  if (grant.notBeforeMs !== null && referenceTimeMs < grant.notBeforeMs) return deny("NOT_YET_VALID");
  if (grant.notAfterMs !== null && referenceTimeMs >= grant.notAfterMs) return deny("EXPIRED");
  return { allowed: true };
}

/**
 * Decide whether a grant authorizes an access request at `referenceTimeMs`. Checks, in order: presence,
 * party match, revocation, validity window, then each scope axis, and finally the seller-private field gate.
 * A revoked or expired grant is denied BEFORE any scope is considered.
 */
export function evaluateGrant(
  grant: DataGrant | null,
  req: GrantAccessRequest,
  referenceTimeMs: number,
): GrantDecision {
  if (grant === null) return deny("NO_GRANT");
  if (grant.sellerId !== req.sellerId) return deny("WRONG_SELLER");
  if (grant.manufacturerId !== req.manufacturerId) return deny("WRONG_MANUFACTURER");
  if (grant.revoked) return deny("REVOKED");

  const window = withinValidityWindow(grant, referenceTimeMs);
  if (!window.allowed) return window;

  const { scope } = grant;
  if (!scope.channels.includes(req.channel)) return deny("CHANNEL_OUT_OF_SCOPE");
  if (scope.productIds !== "ALL") {
    if (req.productId === null || !scope.productIds.includes(req.productId)) return deny("PRODUCT_OUT_OF_SCOPE");
  }
  if (!scope.signalKinds.includes(req.signalKind)) return deny("SIGNAL_KIND_OUT_OF_SCOPE");
  if (req.needsSellerPrivateFields && !scope.includeSellerPrivateFields) return deny("SELLER_PRIVATE_NOT_GRANTED");

  return { allowed: true };
}
