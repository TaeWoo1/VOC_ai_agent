/**
 * **Approval policy** (pure, offline) — conservative by default.
 *
 * Decides whether a proposed action needs a human sign-off before it can become an {@link ActionIntent}.
 * Approval requirement is derived from the action's side-effect class (`action-authority.ts`), NOT a
 * hand-maintained allow-list: **only INTERNAL, non-side-effect actions (classification, internal task
 * creation) may auto-approve.** Everything else — every seller-channel write (inquiry/review reply,
 * order/shipment change, cancellation/refund/claim, external write) and every `REQUEST_SELLER_ACTION` —
 * requires explicit human approval. For a seller-channel write, action authority forces the owner to be the
 * seller, so that human approver IS the seller.
 *
 * The gate itself lives in `work-item.ts`: a work item cannot reach an action intent until it is `APPROVED`
 * (auto for internal actions, human otherwise).
 */

import type { ActionKind } from "./types";
import { effectClassOf } from "./action-authority";

/** The approval policy — pure configuration consumed by {@link requiresApproval}. */
export interface ApprovalPolicy {
  /** When true, INTERNAL (non-side-effect) actions auto-approve. Side-effect / request actions never do. */
  autoApproveInternalActions: boolean;
}

/** The inputs an approval decision depends on. */
export interface ApprovalContext {
  actionKind: ActionKind;
}

/** Conservative default: internal actions auto-approve; everything with a side effect needs a human. */
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  autoApproveInternalActions: true,
};

/** True iff the proposed action requires a human approver under this policy. */
export function requiresApproval(policy: ApprovalPolicy, ctx: ApprovalContext): boolean {
  return !(policy.autoApproveInternalActions && effectClassOf(ctx.actionKind) === "INTERNAL");
}
