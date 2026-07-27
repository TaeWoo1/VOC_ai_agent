/**
 * The adversarial root-cause loop's discipline, offline: single-variable experiments, run isolation, one run at
 * a time, terminal-state-or-discard, and attribution that refuses to guess.
 */
import { describe, expect, it } from "vitest";
import {
  AdversarialLoop,
  attributeRootCause,
  runIdentity,
  validateSingleVariable,
  type AdversarialBaseline,
  type AdversarialRunSpec,
  type AdversarialRunResult,
} from "../../../src/action-window/initial-import/adversarial-loop";
import type { AcquisitionOutcome, AdversarialVariable } from "../../../../contracts/acquisition/v1/index";

const BASELINE: AdversarialBaseline = {
  accountKey: "acct-A",
  profileKey: "prof-A",
  guidancePackKey: "pack-1",
  entryPoint: "guided-card",
};

function spec(runId: string, variable: AdversarialVariable | null): AdversarialRunSpec {
  return { runId, sessionId: `s-${runId}`, surfaceId: `f-${runId}`, baseline: BASELINE, variable };
}

const baselineSpec = spec("r0", null);

function result(s: AdversarialRunSpec, outcome: AcquisitionOutcome | null): AdversarialRunResult {
  return { spec: s, outcome };
}

describe("adversarial loop — experiment validity", () => {
  it("a variant must change exactly one variable", () => {
    expect(() => validateSingleVariable(spec("r1", "OVERLAY_TIMING"), baselineSpec)).not.toThrow();
    // A "variant" that varies nothing is not a variant.
    expect(() => validateSingleVariable(spec("r1", null), baselineSpec)).toThrow(/vary nothing/);
  });

  it("a variant may not change the frozen baseline context", () => {
    const drifted: AdversarialRunSpec = {
      ...spec("r1", "TIMING"),
      baseline: { ...BASELINE, accountKey: "acct-B" },
    };
    expect(() => validateSingleVariable(drifted, baselineSpec)).toThrow(/frozen baseline/);
  });

  it("every run has a distinct runId+sessionId+surfaceId identity", () => {
    expect(runIdentity(spec("r1", "TIMING"))).toBe("r1::s-r1::f-r1");
    expect(runIdentity(spec("r2", "TIMING"))).not.toBe(runIdentity(spec("r1", "TIMING")));
  });
});

describe("adversarial loop — one run at a time, isolation, terminal-or-discard", () => {
  it("serializes runs so only one is ever in flight", async () => {
    const loop = new AdversarialLoop();
    let active = 0;
    let maxActive = 0;
    const exec = async (): Promise<AcquisitionOutcome> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return "OK";
    };
    await Promise.all([
      loop.run(spec("r1", "TIMING"), baselineSpec, exec),
      loop.run(spec("r2", "NAVIGATION"), baselineSpec, exec),
      loop.run(spec("r3", "RECHECK"), baselineSpec, exec),
    ]);
    expect(maxActive).toBe(1);
  });

  it("refuses a re-used run identity", async () => {
    const loop = new AdversarialLoop();
    await loop.run(spec("r1", "TIMING"), baselineSpec, async () => "OK");
    await expect(loop.run(spec("r1", "NAVIGATION"), baselineSpec, async () => "OK")).rejects.toThrow(/identity re-used/);
  });

  it("records a run that threw as a discard (outcome null), not evidence, and keeps the loop alive", async () => {
    const loop = new AdversarialLoop();
    const bad = await loop.run(spec("r1", "TIMING"), baselineSpec, async () => {
      throw new Error("window vanished mid-run");
    });
    expect(bad.outcome).toBeNull();
    // The lock survived: the next run still runs.
    const good = await loop.run(spec("r2", "TIMING"), baselineSpec, async () => "OK");
    expect(good.outcome).toBe("OK");
  });
});

describe("adversarial loop — attribution refuses to guess", () => {
  const base = result(baselineSpec, "OK");

  it("confirms the one axis whose variant flipped the outcome", () => {
    const variants = [
      result(spec("r1", "TIMING"), "OK"),
      result(spec("r2", "OVERLAY_TIMING"), "OVERLAY_NOT_VISIBLE"),
      result(spec("r3", "NAVIGATION"), "OK"),
    ];
    expect(attributeRootCause(base, variants)).toEqual({
      kind: "CONFIRMED",
      variable: "OVERLAY_TIMING",
      outcome: "OVERLAY_NOT_VISIBLE",
    });
  });

  it("reports NO_DIFFERENCE when no variant changed the outcome", () => {
    const variants = [result(spec("r1", "TIMING"), "OK"), result(spec("r2", "RECHECK"), "OK")];
    expect(attributeRootCause(base, variants)).toEqual({ kind: "NO_DIFFERENCE" });
  });

  it("is INCONCLUSIVE when more than one axis flips the outcome — never attributes to a guess", () => {
    const variants = [
      result(spec("r1", "OVERLAY_TIMING"), "OVERLAY_NOT_VISIBLE"),
      result(spec("r2", "SESSION_FRESHNESS"), "SESSION_NOT_READY"),
    ];
    expect(attributeRootCause(base, variants).kind).toBe("INCONCLUSIVE");
  });

  it("ignores discarded runs (null outcome) as evidence", () => {
    const variants = [result(spec("r1", "TIMING"), null), result(spec("r2", "OVERLAY_TIMING"), "OVERLAY_MOUNT_FAILED")];
    expect(attributeRootCause(base, variants)).toEqual({
      kind: "CONFIRMED",
      variable: "OVERLAY_TIMING",
      outcome: "OVERLAY_MOUNT_FAILED",
    });
  });

  it("is INCONCLUSIVE when the baseline itself reached no terminal outcome", () => {
    expect(attributeRootCause(result(baselineSpec, null), []).kind).toBe("INCONCLUSIVE");
  });

  it("is INCONCLUSIVE when one axis produced inconsistent outcomes — a flaky axis is not a confirmed cause", () => {
    const variants = [
      result(spec("r1", "TIMING"), "SURFACE_CLOSED"),
      result(spec("r2", "TIMING"), "OVERLAY_NOT_VISIBLE"),
    ];
    expect(attributeRootCause(base, variants).kind).toBe("INCONCLUSIVE");
  });

  it("is INCONCLUSIVE when one run of the differing axis matched baseline while another differed", () => {
    const variants = [
      result(spec("r1", "OVERLAY_TIMING"), "OVERLAY_NOT_VISIBLE"),
      result(spec("r2", "OVERLAY_TIMING"), "OK"),
    ];
    expect(attributeRootCause(base, variants).kind).toBe("INCONCLUSIVE");
  });

  it("CONFIRMS when the same axis repeats the same outcome across runs", () => {
    const variants = [
      result(spec("r1", "OVERLAY_TIMING"), "OVERLAY_NOT_VISIBLE"),
      result(spec("r2", "OVERLAY_TIMING"), "OVERLAY_NOT_VISIBLE"),
    ];
    expect(attributeRootCause(base, variants)).toEqual({
      kind: "CONFIRMED",
      variable: "OVERLAY_TIMING",
      outcome: "OVERLAY_NOT_VISIBLE",
    });
  });
});
