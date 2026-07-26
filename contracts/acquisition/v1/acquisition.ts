/**
 * **Acquisition supervision — the channel-neutral "how do we acquire this, and may we start?" contract (v1).**
 *
 * Session readiness (`../../session-readiness/v1`) answers "is this channel's session usable right now?".
 * This contract answers the next two questions, once readiness is known:
 *
 *   1. **How is `(channel × capability)` acquired?** — resolve it to an {@link ExecutionMode} (API / webhook /
 *      Action Window / file), reusing the seller-facing mode enum the Action Window command port already
 *      carries. There is no new mode axis: a webhook is `AUTOMATIC_OPERATION` with `PUSH` delivery, not a
 *      fifth mode.
 *   2. **May the Agent start, or must it ask the seller for one thing first?** — gate that mode on the
 *      channel's readiness and produce a single {@link SupervisorDecision}: `DISPATCH`, `ASK_SELLER` (with the
 *      readiness contract's exactly-one action), or `HOLD` (nothing to do — either the session was not
 *      observed, or the capability is not integrated).
 *
 * ## What it is (and is not)
 *
 * It is a PURE state contract, a sibling of `../../review-import-journey/v1` and `../../session-readiness/v1`:
 * no I/O, no logging, no browser, no clock, type-checked under `contracts/tsconfig.json` (no DOM, no Node). It
 * carries only sanitized enums — a channel code, a capability, a mode, a delivery kind, a checkpoint shape,
 * and (for `ASK_SELLER`) the readiness action. It NEVER carries a token, cookie, seller/account id, URL, page
 * text, or a marketplace ref; a caller derives everything upstream and drops it before anything reaches here.
 *
 * The actual `(channel × capability) → mode` assignments are NOT in this contract — they are marketplace-
 * capability truth (the connector roadmap §4.1 living table) and live in the collector, which passes them in
 * as {@link AcquisitionResolutionRow}s. This contract owns only the neutral vocabulary and the two pure
 * functions that fold rows + readiness into a plan and a decision.
 *
 * ## Fail closed, never infer
 *
 * A `(channel, capability)` with no resolution row is `INTEGRATION_PENDING` — the same discipline readiness
 * uses for an unobserved channel. It is NOT "probably API"; it is "not integrated", and it can never be
 * dispatched. Everything ambiguous resolves toward NOT starting, never toward acting.
 */

import { EXECUTION_MODES, type ExecutionMode } from "../../action-window/v2/index";
import {
  singleActionForReadiness,
  type ReadinessAction,
  type SessionReadinessState,
} from "../../session-readiness/v1/index";

/**
 * What is being acquired or operated on a channel. Aligned with the Action Window run intents and the
 * capability ledger; it is the "what", orthogonal to the "how" ({@link ExecutionMode}).
 */
export type AcquisitionCapability = "REVIEW" | "INQUIRY" | "ORDER_SUMMARY" | "REPLY_SUBMISSION";

export const ACQUISITION_CAPABILITIES: readonly AcquisitionCapability[] = [
  "REVIEW",
  "INQUIRY",
  "ORDER_SUMMARY",
  "REPLY_SUBMISSION",
];

/**
 * How an `AUTOMATIC_OPERATION` mode is delivered. A webhook is not a distinct mode — it is the same official-
 * API branch reached by a `PUSH` (the marketplace calls us) instead of a `PULL` (we call the marketplace).
 * Only meaningful for `AUTOMATIC_OPERATION`; the other modes leave it unset.
 */
export type DeliveryKind = "PULL" | "PUSH";

/**
 * The shape of the human checkpoint a mode implies — the single point at which a person is in the loop.
 * Canonically derived from the mode ({@link checkpointShapeForMode}) so it can never drift from it.
 *
 * - `APPROVAL` — the seller approves; approval IS the checkpoint (official API / webhook: no marketplace DOM).
 * - `MARKETPLACE_ACTION` — the seller performs one real action on the marketplace page (Action Window).
 * - `FILE_SELECTION` — the seller selects the official export file to import (file upload).
 * - `NONE` — nothing to check because there is nothing to do (`INTEGRATION_PENDING`).
 */
export type CheckpointShape = "APPROVAL" | "MARKETPLACE_ACTION" | "FILE_SELECTION" | "NONE";

/**
 * The single checkpoint shape a mode implies — total and deterministic, so a plan's checkpoint is always the
 * canonical one for its mode and never a hand-set value that could disagree with it.
 */
export function checkpointShapeForMode(mode: ExecutionMode): CheckpointShape {
  switch (mode) {
    case "AUTOMATIC_OPERATION":
      return "APPROVAL";
    case "ACTION_WINDOW":
      return "MARKETPLACE_ACTION";
    case "FILE_IMPORT":
      return "FILE_SELECTION";
    case "INTEGRATION_PENDING":
      return "NONE";
    default: {
      // Exhaustiveness: a new mode that isn't mapped is a compile error, not a silent fall-through.
      const _exhaustive: never = mode;
      void _exhaustive;
      return "NONE";
    }
  }
}

/**
 * One row of the `(channel × capability) → mode` matrix, supplied by the collector from the roadmap §4.1
 * living table. Sanitized: a channel-code enum, a capability, a mode, and — only for `AUTOMATIC_OPERATION` —
 * a delivery kind. A capability with no row is deliberately absent (it fails closed to `INTEGRATION_PENDING`).
 */
export interface AcquisitionResolutionRow {
  readonly channelCode: string;
  readonly capability: AcquisitionCapability;
  readonly mode: ExecutionMode;
  /** Only for `AUTOMATIC_OPERATION` (PULL = we call the API, PUSH = webhook). Omit for other modes. */
  readonly delivery?: DeliveryKind;
}

/**
 * A resolved acquisition plan — how one `(channel × capability)` is acquired, plus the checkpoint that mode
 * implies. This is the whole shape a supervisor acts on; there is nowhere in it for a token, id, URL, or ref.
 */
export interface AcquisitionPlan {
  readonly channelCode: string;
  readonly capability: AcquisitionCapability;
  readonly mode: ExecutionMode;
  /** Present only when `mode` is `AUTOMATIC_OPERATION`. */
  readonly delivery?: DeliveryKind;
  /** The canonical checkpoint shape for `mode` (`checkpointShapeForMode`). */
  readonly checkpoint: CheckpointShape;
}

/**
 * What the supervisor decides for a `(channel × capability)` given the channel's readiness.
 *
 * - `DISPATCH` — the session is READY and the capability is integrated; the mode's vertical stack may run.
 * - `ASK_SELLER` — the session is not READY; offer the readiness contract's exactly-one `action` and do NOT
 *   dispatch. This is the acquisition-side face of the readiness "one action" and the human checkpoint.
 * - `HOLD_UNOBSERVED` — the channel's session was not observed at all; infer nothing, ask nothing.
 * - `HOLD_UNSUPPORTED` — the `(channel, capability)` is `INTEGRATION_PENDING`; there is no mode to dispatch,
 *   independent of readiness. Distinct from `HOLD_UNOBSERVED` so "not integrated" is never mislabeled as
 *   "not seen".
 */
export type SupervisorDecision =
  | { readonly kind: "DISPATCH"; readonly plan: AcquisitionPlan }
  | { readonly kind: "ASK_SELLER"; readonly action: ReadinessAction; readonly plan: AcquisitionPlan }
  | { readonly kind: "HOLD_UNOBSERVED"; readonly plan: AcquisitionPlan }
  | { readonly kind: "HOLD_UNSUPPORTED"; readonly plan: AcquisitionPlan };

/**
 * Resolve `(channel × capability)` to a plan from the supplied matrix. Pure and total. A row match yields its
 * mode/delivery and the canonical checkpoint; NO match fails closed to an `INTEGRATION_PENDING` plan — never a
 * guessed mode. The first matching row wins (callers keep the matrix unambiguous).
 */
export function resolveAcquisition(
  channelCode: string,
  capability: AcquisitionCapability,
  rows: readonly AcquisitionResolutionRow[],
): AcquisitionPlan {
  const row = rows.find((r) => r.channelCode === channelCode && r.capability === capability);
  if (row === undefined) {
    return {
      channelCode,
      capability,
      mode: "INTEGRATION_PENDING",
      checkpoint: checkpointShapeForMode("INTEGRATION_PENDING"),
    };
  }
  const base = {
    channelCode,
    capability,
    mode: row.mode,
    checkpoint: checkpointShapeForMode(row.mode),
  };
  // Delivery only belongs on AUTOMATIC_OPERATION; drop it otherwise so a plan never carries a stray PULL/PUSH.
  return row.mode === "AUTOMATIC_OPERATION" && row.delivery !== undefined
    ? { ...base, delivery: row.delivery }
    : base;
}

/**
 * Gate a resolved plan on the channel's readiness. Pure and total.
 *
 * Order matters and is deliberately readiness-independent for the unsupported case: an `INTEGRATION_PENDING`
 * plan can never dispatch, so it resolves to `HOLD_UNSUPPORTED` BEFORE readiness is even consulted — a channel
 * being READY does not make an un-integrated capability runnable. Otherwise: READY dispatches; an unobserved
 * session holds; every other readiness state asks the seller for its single action.
 */
export function decideAcquisition(readiness: SessionReadinessState, plan: AcquisitionPlan): SupervisorDecision {
  if (plan.mode === "INTEGRATION_PENDING") {
    return { kind: "HOLD_UNSUPPORTED", plan };
  }
  switch (readiness) {
    case "READY":
      return { kind: "DISPATCH", plan };
    case "UNOBSERVED_EXTERNAL":
      return { kind: "HOLD_UNOBSERVED", plan };
    case "LOGIN_REQUIRED":
    case "EXPIRED":
    case "TWO_FACTOR_REQUIRED":
    case "ACCOUNT_AMBIGUOUS":
      // The readiness contract owns the exactly-one action; reuse it so the two can never diverge.
      return { kind: "ASK_SELLER", action: singleActionForReadiness(readiness), plan };
    default: {
      // Exhaustiveness: a new readiness state is a compile error. An unknown value (only via an `any`-typed
      // caller) fails closed to ASK_SELLER — never to DISPATCH.
      const _exhaustive: never = readiness;
      void _exhaustive;
      return { kind: "ASK_SELLER", action: singleActionForReadiness("EXPIRED"), plan };
    }
  }
}

/** Re-exported so callers building a matrix or switching on a mode use the same source as the wire contract. */
export { EXECUTION_MODES, type ExecutionMode };
