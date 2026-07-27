/**
 * **Guided Acquisition Reliability — the controlled adversarial root-cause loop.**
 *
 * When a guided run fails intermittently, a pile of live runs that each changed several things at once proves
 * nothing: any of the changes could own the difference. This harness enforces the discipline that makes a live
 * difference *attributable*:
 *
 *  1. **A fixed baseline** — same account, profile, guidance pack, and entry point on every run. The baseline
 *     spec changes NO variable; a variant changes exactly ONE ({@link AdversarialVariable}).
 *  2. **One variable per run.** {@link validateSingleVariable} refuses a variant that moved more than one axis,
 *     so an experiment that could not attribute its result never runs.
 *  3. **Run isolation.** Every run carries a distinct `runId + sessionId + surfaceId` triple
 *     ({@link runIdentity}); two runs can never be confused for one another in the evidence.
 *  4. **One live run at a time.** {@link AdversarialLoop.run} holds an internal lock, so overlapping runs (which
 *     would contend on the one marketplace window and muddy attribution) cannot happen.
 *  5. **Every run ends in exactly one terminal state.** A run whose exec does not return a terminal
 *     {@link AcquisitionOutcome} (it threw, or returned null) is DISCARDED — never counted as evidence.
 *  6. **Attribution or nothing.** {@link attributeRootCause} confirms a root cause only when exactly one
 *     variable's variant flipped the outcome away from the baseline. Anything ambiguous returns inconclusive,
 *     and the operator does not get to pretend a run proved something it did not.
 *
 * Pure orchestration: the actual run is an injected `exec`, so the whole policy — the lock, the single-variable
 * guard, the terminal-state requirement, the attribution — is unit-testable offline with no browser. Wiring
 * `exec` to a REAL marketplace session is a separately-approved live step; this module never opens a window.
 */
import type {
  AcquisitionOutcome,
  AdversarialVariable,
} from "../../../../contracts/acquisition/v1/index";

/** The frozen context every run shares. A variant changes exactly one {@link AdversarialVariable}, never these. */
export interface AdversarialBaseline {
  /** Opaque, reversible-to-nothing markers — sameness is all that matters, never the real identity. */
  readonly accountKey: string;
  readonly profileKey: string;
  readonly guidancePackKey: string;
  readonly entryPoint: string;
}

/** One run: the baseline, the single axis it varies (`null` = the baseline run itself), and its isolation ids. */
export interface AdversarialRunSpec {
  readonly runId: string;
  readonly sessionId: string;
  readonly surfaceId: string;
  readonly baseline: AdversarialBaseline;
  /** The one axis this run changes from the baseline, or `null` for the baseline run. */
  readonly variable: AdversarialVariable | null;
}

export interface AdversarialRunResult {
  readonly spec: AdversarialRunSpec;
  /** The terminal classification, or `null` when the run failed to reach one (discarded — not evidence). */
  readonly outcome: AcquisitionOutcome | null;
}

/** The distinct isolation key of a run — no two runs in one loop may share it. */
export function runIdentity(spec: AdversarialRunSpec): string {
  return `${spec.runId}::${spec.sessionId}::${spec.surfaceId}`;
}

/**
 * A variant must differ from the baseline in EXACTLY one variable. The baseline run (`variable === null`) is the
 * one exception. Throws on a malformed experiment so an un-attributable run never reaches the marketplace.
 */
export function validateSingleVariable(spec: AdversarialRunSpec, baselineSpec: AdversarialRunSpec): void {
  if (spec === baselineSpec) return;
  if (spec.variable === null) throw new Error("adversarial-loop: only the baseline run may vary nothing");
  // The baseline context must be identical object-by-field — a variant changes the AXIS, never the frozen
  // context. (The variable's effect is applied by `exec`, keyed off `spec.variable`; the baseline stays fixed.)
  const b = spec.baseline;
  const bb = baselineSpec.baseline;
  if (b.accountKey !== bb.accountKey || b.profileKey !== bb.profileKey || b.guidancePackKey !== bb.guidancePackKey || b.entryPoint !== bb.entryPoint) {
    throw new Error("adversarial-loop: a variant changed the frozen baseline, not just its one variable");
  }
}

/** How a run's exec is invoked. Returns a terminal outcome, or throws / returns null to be discarded. */
export type AdversarialExec = (spec: AdversarialRunSpec) => Promise<AcquisitionOutcome | null>;

export class AdversarialLoop {
  /** The single-live-run lock: a promise chain that serializes every run through one at a time. */
  private tail: Promise<unknown> = Promise.resolve();
  private readonly seenIdentities = new Set<string>();

  /**
   * Run one spec under the lock. Isolation, single-variable, and terminal-state rules are enforced here; a run
   * that violates isolation throws, and a run that fails to reach a terminal outcome is recorded as
   * `outcome: null` (discarded, not evidence) rather than crashing the loop.
   */
  async run(spec: AdversarialRunSpec, baselineSpec: AdversarialRunSpec, exec: AdversarialExec): Promise<AdversarialRunResult> {
    validateSingleVariable(spec, baselineSpec);
    const identity = runIdentity(spec);
    if (this.seenIdentities.has(identity)) {
      throw new Error("adversarial-loop: run identity re-used; every run needs a distinct runId+sessionId+surfaceId");
    }
    this.seenIdentities.add(identity);
    // Serialize: chain onto the tail so only one run is ever in flight, whatever the caller does.
    const gated = this.tail.then(async (): Promise<AdversarialRunResult> => {
      try {
        const outcome = await exec(spec);
        return { spec, outcome: outcome ?? null };
      } catch {
        // A run that threw did not reach a classified terminal state — discard it, do not let it be evidence.
        return { spec, outcome: null };
      }
    });
    // Keep the lock chain alive even if this run rejected (it cannot, we swallow above) so the next run still runs.
    this.tail = gated.catch(() => undefined);
    return gated;
  }
}

/** The verdict of a completed experiment. `confirmed` names the one axis that owns the difference, if any. */
export type RootCauseVerdict =
  | { readonly kind: "CONFIRMED"; readonly variable: AdversarialVariable; readonly outcome: AcquisitionOutcome }
  | { readonly kind: "NO_DIFFERENCE" }
  | { readonly kind: "INCONCLUSIVE"; readonly reason: string };

/**
 * Attribute a difference to a single axis, or refuse to.
 *
 *  - Only runs that reached a terminal outcome count; discarded runs (`outcome === null`) are ignored as
 *    evidence, and a missing baseline outcome makes the whole experiment inconclusive.
 *  - A variant whose outcome equals the baseline changed nothing observable and is not evidence of a cause.
 *  - If exactly one variable flipped the outcome, that is the confirmed root cause. If several different
 *    variables each flipped it, the cause is not isolated to one axis → inconclusive (never a guess).
 */
export function attributeRootCause(baseline: AdversarialRunResult, variants: readonly AdversarialRunResult[]): RootCauseVerdict {
  if (baseline.outcome === null) return { kind: "INCONCLUSIVE", reason: "baseline run reached no terminal outcome" };
  const differing = variants.filter(
    (v): v is AdversarialRunResult & { spec: { variable: AdversarialVariable } } =>
      v.outcome !== null && v.spec.variable !== null && v.outcome !== baseline.outcome,
  );
  if (differing.length === 0) return { kind: "NO_DIFFERENCE" };
  const axes = new Set(differing.map((v) => v.spec.variable));
  if (axes.size > 1) {
    return { kind: "INCONCLUSIVE", reason: "more than one variable changed the outcome; cause is not isolated to one axis" };
  }
  const first = differing[0]!;
  return { kind: "CONFIRMED", variable: first.spec.variable, outcome: first.outcome! };
}
