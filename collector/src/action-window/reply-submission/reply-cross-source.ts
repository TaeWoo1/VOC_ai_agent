/**
 * **Cross-source equality (pure).** At the escalation checkpoint — AFTER the fresh target bundle is minted —
 * the calibrated live review row is fingerprinted in-page and compared to the bundle's backend `bodyFingerprint`.
 * Equality establishes operator-confirmed cross-source equality FOR THIS ONE target (after any 더보기 expansion):
 * the live NAVER DOM body normalizes to the same fingerprint the backend derived from the stored body. This is
 * a per-target proof only — global cross-source robustness (arbitrary rows) is an explicit non-goal (B1).
 *
 * Fail-closed: a missing live fingerprint or any mismatch refuses BEFORE a run is assembled, so the mutating
 * abort rehearsal never starts against an unconfirmed target. Neither fingerprint is ever logged.
 */
export type CrossSourceResult = { ok: true } | { ok: false; code: "NO_LIVE_FINGERPRINT" | "MISMATCH" };

/**
 * Compare the live, in-page-computed row fingerprint to the backend bundle fingerprint. `null` live input
 * (the row/body could not be addressed) fails closed as `NO_LIVE_FINGERPRINT`; an inequality fails closed as
 * `MISMATCH`. Only equal, non-null fingerprints pass.
 */
export function compareCrossSource(liveFingerprint: string | null, backendFingerprint: string): CrossSourceResult {
  if (!liveFingerprint) return { ok: false, code: "NO_LIVE_FINGERPRINT" };
  if (liveFingerprint !== backendFingerprint) return { ok: false, code: "MISMATCH" };
  return { ok: true };
}

/** Operator-facing refusal for a failed cross-source preflight — never prints either fingerprint value. */
export function crossSourceRefusalMessage(code: "NO_LIVE_FINGERPRINT" | "MISMATCH"): string {
  const why =
    code === "NO_LIVE_FINGERPRINT"
      ? "the calibrated row's body could not be read in-page (expand 더보기, then re-calibrate)"
      : "the live row body does not match the approved review's fingerprint (wrong row, or truncated — expand 더보기 and re-calibrate)";
  return [
    `Refusing to start the reply run: cross-source equality failed — ${why}.`,
    "  - The abort rehearsal never starts against an unconfirmed target; no run is assembled.",
    "  - Re-calibrate on the intended review (fully expanded) and re-run.",
  ].join("\n");
}
