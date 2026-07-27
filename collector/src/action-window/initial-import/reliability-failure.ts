/**
 * **Guided Acquisition Reliability — the driver → session failure signal.**
 *
 * A guided run's DOM work (opening the window, settling the surface, mounting the overlay) can fail in ways
 * that are neither a normal blocker the engine already models nor a fatal crash. Before this slice those
 * failures were swallowed by a `.catch(() => {})` and the run went silent. `ReliabilityFailure` is how a driver
 * now says "this specific reliability stage failed" out loud: it throws one, the session catches it, records
 * the sanitized marker, and parks the engine on the recoverable {@link ReliabilityBlockerCode} — a visible
 * state with one recovery action instead of a frozen page.
 *
 * It carries ONLY the sanitized failure code — never a message with a URL, selector, filename, or account. The
 * `Error.message` is the code itself, so even an un-caught throw logs nothing un-sanitized.
 */
import type { ReliabilityBlockerCode } from "./import-engine";

export class ReliabilityFailure extends Error {
  readonly code: ReliabilityBlockerCode;
  constructor(code: ReliabilityBlockerCode) {
    // The message IS the code — a sanitized enum, safe to surface anywhere an Error is stringified.
    super(code);
    this.name = "ReliabilityFailure";
    this.code = code;
    // Preserve the prototype chain across the TS `extends Error` transpile so `instanceof` holds.
    Object.setPrototypeOf(this, ReliabilityFailure.prototype);
  }
}

/** Narrow an unknown caught value to a {@link ReliabilityFailure}. */
export function isReliabilityFailure(e: unknown): e is ReliabilityFailure {
  return e instanceof ReliabilityFailure;
}
