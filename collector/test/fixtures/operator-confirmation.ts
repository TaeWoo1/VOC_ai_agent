/**
 * Test-only confirmations for the WING recorder's operator-confirmation seam.
 *
 * It lives in the test tree ON PURPOSE. A production helper that turns the string `"ready"` into a confirmation
 * would hand back exactly the forgery the channel exists to prevent — the whole point is that `ready` is not a
 * value anything can mint outside a verified press. Tests may fake the seam; the product may not.
 */
import {
  OPERATOR_UI_CONFIRMED,
  type OperatorConfirmation,
} from "../../src/cli/operator-confirm";
import type { WingRecordSignal } from "../../instruments/calibration/probe-wing-issuance-selectors";

/** A confirmed press of the primary button. */
export const OPERATOR_CONFIRMED: OperatorConfirmation = {
  signal: "ready",
  provenance: OPERATOR_UI_CONFIRMED,
  choice: "primary",
};
/** The operator stopped the session. */
export const OPERATOR_ABORTED: OperatorConfirmation = { signal: "abort", provenance: null };
/** Nobody pressed anything within the budget. */
export const OPERATOR_TIMED_OUT: OperatorConfirmation = { signal: "timeout", provenance: null };

/** Map a legacy signal name onto its confirmation, for fakes that drive a script of signals. */
export function confirmationFor(signal: WingRecordSignal): OperatorConfirmation {
  return signal === "ready" ? OPERATOR_CONFIRMED : signal === "abort" ? OPERATOR_ABORTED : OPERATOR_TIMED_OUT;
}
