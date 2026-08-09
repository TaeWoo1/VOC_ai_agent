/**
 * Behavioral test for `CoupangWingDeletionDriver`, driven over a FAKE page — no browser, no WING.
 *
 * Locks the destructive-walk invariants: (a) the delete target is measured value-free (0 / 1 / many, sig only on a
 * unique match); (b) it classifies only the ALREADY-ISSUED page as actionable; (c) it FAILS CLOSED on highlight
 * whenever the delete selector calibration is withdrawn; (d) the CHECKPOINT-FIRST invariant — the operator-action
 * step (`verifyDeletion`) is unreachable until the irreversible-warning checkpoint has been shown; and (e) the
 * driver reads NO field value (the fake page exposes ONLY `evaluate` / `url` / `on`).
 *
 * The 삭제 calibration is WITHDRAWN, so the production default REFUSES to highlight — `makeDriver` therefore
 * injects `calibrated: true` and the walk cases below exercise an override, not the shipped shape. What ships is
 * asserted separately by the intent marker and the uncalibrated-refusal case; do not read these as describing
 * what a real run does today.
 */
import { describe, expect, it } from "vitest";
import {
  CoupangWingDeletionDriver,
  WING_DELETION_WARNING_LABEL,
} from "../../../src/action-window/coupang-wing-deletion-driver";
import {
  WING_DELETION_CALIBRATION_EVIDENCE,
  WING_DELETION_LABELS,
  WING_DELETION_SELECTORS_CALIBRATED,
} from "../../../src/action-window/coupang-wing-issuance-driver";
import type { OverlayOptions } from "../../../src/action-window/overlay";
import type { WingStructuralCensus } from "../../../src/cli/coupang-wing-classifier";

const ISSUED: WingStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: true,
  formCount: 1,
  editableTextInputCount: 0,
  readonlyFieldCount: 1,
  listLikeContainerCount: 2,
  openApiMarkerPresent: true,
};
const CREDENTIAL_SHOWN: WingStructuralCensus = { ...ISSUED, openApiMarkerPresent: false, readonlyFieldCount: 2 };
const WING_HOME: WingStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  formCount: 0,
  editableTextInputCount: 0,
  readonlyFieldCount: 0,
  listLikeContainerCount: 2,
  openApiMarkerPresent: false,
};
const LOGIN: WingStructuralCensus = { ...WING_HOME, passwordFieldPresent: true };

type EvalReturn = unknown;

/** A minimal read-only fake Page: ONLY `evaluate` / `url` / `on`. `census` is mutable so a post-delete page swap can be simulated. */
class FakePage {
  public readonly scripts: string[] = [];
  public census: WingStructuralCensus;
  constructor(
    census: WingStructuralCensus,
    private readonly locate: EvalReturn,
    private readonly urlStr = "https://wing.coupang.com/vendor/open-api",
  ) {
    this.census = census;
  }
  url(): string {
    return this.urlStr;
  }
  on(): void {
    /* close handler — never fires in the test */
  }
  async evaluate(script: string): Promise<EvalReturn> {
    this.scripts.push(script);
    if (typeof script === "string" && script.includes("passwordFieldPresent")) return this.census;
    return this.locate;
  }
}

/** Records every overlay mount so the CHECKPOINT can be asserted on its content, not merely on a phase change. */
type OverlayCall = OverlayOptions;

function makeDriver(
  page: FakePage,
  opts: Record<string, unknown> = {},
  overlayCalls: OverlayCall[] = [],
): CoupangWingDeletionDriver {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CoupangWingDeletionDriver(page as any, {
    // Behavioral tests state the calibration EXPLICITLY rather than leaning on the production default, so that
    // withdrawing `WING_DELETION_SELECTORS_CALIBRATED` — the documented emergency lever — costs exactly one
    // deliberate red test (the intent marker below) instead of a broken suite. The coupling between the default
    // and the constant is asserted separately.
    calibrated: true,
    locatorSettleMs: 0,
    verifyPollMs: 0,
    mountOverlayFn: async (_page, o) => {
      overlayCalls.push(o);
    },
    // Default: the checkpoint painted. A test overrides this to prove a SILENT mount failure fails closed.
    checkpointPaintedFn: async () => true,
    ...opts,
  });
}

describe("CoupangWingDeletionDriver.probeDeleteMatch — read-only 삭제 measurement", () => {
  it("reports matchCount + a 16-hex sig for a UNIQUE match", async () => {
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }));
    const res = await driver.probeDeleteMatch();
    expect(res).toEqual({ matchCount: 1, canHighlight: true, sig: "0123456789abcdef" });
  });

  it("reports NO sig when the 삭제 label does not resolve uniquely (0 or many)", async () => {
    for (const count of [0, 4]) {
      const driver = makeDriver(new FakePage(ISSUED, { count }));
      const res = await driver.probeDeleteMatch();
      expect(res.matchCount).toBe(count);
      expect(res.canHighlight).toBe(false);
      expect(res.sig).toBeUndefined();
    }
  });
});

describe("CoupangWingDeletionDriver.classifyAlreadyIssued — actionable only on the already-issued page", () => {
  it("accepts the already-issued open-API page (open_api_issuance / credential_shown)", async () => {
    for (const [census, cat] of [
      [ISSUED, "open_api_issuance"],
      [CREDENTIAL_SHOWN, "credential_shown"],
    ] as const) {
      const driver = makeDriver(new FakePage(census, { count: 1, sig: "0123456789abcdef" }));
      const r = await driver.classifyAlreadyIssued();
      expect(r.ok).toBe(true);
      expect(r.pageCategory).toBe(cat);
      expect(driver.currentPhase()).toBe("classified");
    }
  });

  it("rejects a wrong page (wing_home / login) — the deletion walk must not proceed", async () => {
    for (const census of [WING_HOME, LOGIN]) {
      const driver = makeDriver(new FakePage(census, { count: 1, sig: "0123456789abcdef" }));
      const r = await driver.classifyAlreadyIssued();
      expect(r.ok).toBe(false);
      expect(driver.currentPhase()).toBe("init");
    }
  });
});

describe("CoupangWingDeletionDriver — fail-closed calibration + checkpoint-first invariant", () => {
  it("REFUSES to highlight when the delete-selector calibration is WITHDRAWN (calibrated:false)", async () => {
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }), { calibrated: false });
    await driver.classifyAlreadyIssued();
    await expect(driver.highlightDeleteCheckpoint()).rejects.toThrow(/CALIBRATION_PENDING|calibrated/);
  });

  it("requires classifying the already-issued page before highlighting", async () => {
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }));
    await expect(driver.highlightDeleteCheckpoint()).rejects.toThrow(/classify/);
  });

  it("the DEFAULT (no option) tracks the production constant — highlight follows the flag, both ways", async () => {
    // The option is a test seam; production reads the constant. Whichever way the constant is set, the default
    // driver must agree with it — so this passes before AND after an emergency withdrawal.
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }), { calibrated: undefined });
    await driver.classifyAlreadyIssued();
    const attempt = driver.highlightDeleteCheckpoint();
    if (WING_DELETION_SELECTORS_CALIBRATED) {
      await expect(attempt).resolves.toEqual({ count: 1, sig: "0123456789abcdef" });
    } else {
      await expect(attempt).rejects.toThrow(/calibrated/);
    }
  });

  it("the operator-action step (verifyDeletion) is UNREACHABLE without the checkpoint", async () => {
    // Fresh driver → phase "init"; and even after classify → phase "classified"; neither may call verifyDeletion.
    const a = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }));
    await expect(a.verifyDeletion()).rejects.toThrow(/checkpoint required/);
    const b = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }));
    await b.classifyAlreadyIssued();
    await expect(b.verifyDeletion()).rejects.toThrow(/checkpoint required/);
  });

  it("the withdrawn-calibration refusal ALSO blocks the operator-action step (no checkpoint ⇒ no verify)", async () => {
    // The two guards compose: an uncalibrated run can never reach `highlighted`, so `verifyDeletion` stays closed
    // even if a caller ignores the highlight throw. There is no path to the operator-delete step without both.
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }), { calibrated: false });
    await driver.classifyAlreadyIssued();
    await expect(driver.highlightDeleteCheckpoint()).rejects.toThrow();
    expect(driver.currentPhase()).toBe("classified");
    await expect(driver.verifyDeletion()).rejects.toThrow(/checkpoint required/);
  });

  it("CALIBRATED + unique: highlights, rests at the checkpoint, then verifies the deletion value-free", async () => {
    // Reached only with `calibrated: true` INJECTED. While the calibration is withdrawn the production default
    // refuses before this point; this case describes the walk, not today's shipped behaviour.
    const page = new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" });
    const driver = makeDriver(page);
    await driver.classifyAlreadyIssued();
    const hl = await driver.highlightDeleteCheckpoint();
    expect(hl).toEqual({ count: 1, sig: "0123456789abcdef" });
    expect(driver.currentPhase()).toBe("highlighted");

    // Operator deletes → the already-issued page is gone (now wing_home). verifyDeletion reads only the category.
    page.census = WING_HOME;
    const v = await driver.verifyDeletion();
    expect(v.deleted).toBe(true);
    expect(v.pageCategory).toBe("wing_home");
    expect(driver.currentPhase()).toBe("done");
  });

  it("the checkpoint actually RENDERS the irreversible warning, legibly, with no advance button", async () => {
    // Phase state is not the checkpoint — the operator reading the warning is. Assert the overlay CONTENT:
    // the irreversible-warning copy, and `residentPanel` so it renders in the readable resident panel rather
    // than the spotlight ring's single-line nowrap badge (where ~130 Korean chars run off the viewport).
    // `advance` must be absent: this walk advances on the operator's sentinel file, so the checkpoint adds no
    // interactive element to the marketplace page.
    const calls: OverlayCall[] = [];
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }), {}, calls);
    await driver.classifyAlreadyIssued();
    await driver.highlightDeleteCheckpoint();

    expect(calls).toHaveLength(1);
    const o = calls[0]!;
    expect(o.label).toBe(WING_DELETION_WARNING_LABEL);
    expect(o.residentPanel).toBe(true);
    expect(o.guidanceEnabled).toBe(true);
    expect(o.advance).toBeUndefined();
    // The warning must state BOTH facts the operator needs before an irreversible press.
    expect(String(o.label)).toContain("되돌릴 수 없");
    expect(String(o.label)).toContain("무효화");
  });

  it("a SILENTLY UNMOUNTED checkpoint fails closed — the phase must not advance on a phantom warning", async () => {
    // `mountOverlay` returns without throwing when the tagged element is gone (SPA re-render during the settle
    // sleep, or a newly-opened tab becoming `activePage()`), so awaiting it proves nothing. If the phase advanced
    // anyway, `verifyDeletion` — whose ONLY precondition is `phase === "highlighted"` — would let the operator
    // reach an irreversible 삭제 with no ring and no warning painted, while the manifest asserts
    // `explicitCheckpointRequired: true`.
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }), {
      checkpointPaintedFn: async () => false,
    });
    await driver.classifyAlreadyIssued();
    const hl = await driver.highlightDeleteCheckpoint();
    expect(hl).toEqual({ count: 0 });
    expect(driver.currentPhase()).toBe("classified"); // NOT highlighted
    await expect(driver.verifyDeletion()).rejects.toThrow(/checkpoint required/);
    // …and the CAUSE is distinguishable: the control WAS found; only the warning failed to render. Reporting
    // this as "삭제 not found" would send the operator hunting for a control that is right there.
    expect(driver.didCheckpointFailToPaint()).toBe(true);
  });

  it("a genuine zero-match is NOT reported as a paint failure", async () => {
    const driver = makeDriver(new FakePage(ISSUED, { count: 0 }));
    await driver.classifyAlreadyIssued();
    await driver.highlightDeleteCheckpoint();
    expect(driver.didCheckpointFailToPaint()).toBe(false);
  });

  it("NO overlay is mounted on any refused path — a fail-closed run never shows a checkpoint", async () => {
    for (const [label, opts, page] of [
      ["withdrawn calibration", { calibrated: false }, new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" })],
      ["zero match", {}, new FakePage(ISSUED, { count: 0 })],
      ["multiple matches", {}, new FakePage(ISSUED, { count: 5 })],
    ] as const) {
      const calls: OverlayCall[] = [];
      const driver = makeDriver(page, opts, calls);
      await driver.classifyAlreadyIssued();
      await driver.highlightDeleteCheckpoint().catch(() => undefined);
      expect(calls, `${label} must not mount a checkpoint`).toHaveLength(0);
    }
  });

  it("CALIBRATED + ZERO match → fails closed: never highlighted, operator-action step unreachable", async () => {
    // Calibration is not a promise the control is present. A page where 삭제 is absent must not rest a checkpoint.
    const driver = makeDriver(new FakePage(ISSUED, { count: 0 }));
    await driver.classifyAlreadyIssued();
    const hl = await driver.highlightDeleteCheckpoint();
    expect(hl).toEqual({ count: 0 });
    expect(hl.sig).toBeUndefined();
    expect(driver.currentPhase()).toBe("classified"); // NOT highlighted
    await expect(driver.verifyDeletion()).rejects.toThrow(/checkpoint required/);
  });

  it("CALIBRATED + MULTIPLE matches → fails closed: never highlighted, operator-action step unreachable", async () => {
    // Ambiguity is refused rather than resolved — highlighting one of several 삭제 controls could point the
    // operator at the wrong irreversible action.
    const driver = makeDriver(new FakePage(ISSUED, { count: 3 }));
    await driver.classifyAlreadyIssued();
    const hl = await driver.highlightDeleteCheckpoint();
    expect(hl).toEqual({ count: 3 });
    expect(hl.sig).toBeUndefined();
    expect(driver.currentPhase()).toBe("classified"); // NOT highlighted
    await expect(driver.verifyDeletion()).rejects.toThrow(/checkpoint required/);
  });

  it("CALIBRATED but a non-unique match arriving WITH a sig is still refused (count is the gate)", async () => {
    // A page (or a future in-page change) that reports many candidates yet still returns a sig must not slip
    // through: the uniqueness check is on `count`, and the sig is dropped.
    const driver = makeDriver(new FakePage(ISSUED, { count: 2, sig: "0123456789abcdef" }));
    await driver.classifyAlreadyIssued();
    const hl = await driver.highlightDeleteCheckpoint();
    expect(hl).toEqual({ count: 2 });
    expect(driver.currentPhase()).toBe("classified");
  });

  it("verifyDeletion reports NOT deleted when the already-issued page is still present", async () => {
    const page = new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" });
    const driver = makeDriver(page);
    await driver.classifyAlreadyIssued();
    await driver.highlightDeleteCheckpoint();
    // census stays ISSUED — the key was not deleted.
    const v = await driver.verifyDeletion();
    expect(v.deleted).toBe(false);
    expect(v.pageCategory).toBe("open_api_issuance");
  });

  it("a wrong page still blocks the whole walk even though the selector is calibrated", async () => {
    const driver = makeDriver(new FakePage(WING_HOME, { count: 1, sig: "0123456789abcdef" }));
    const r = await driver.classifyAlreadyIssued();
    expect(r.ok).toBe(false);
    await expect(driver.highlightDeleteCheckpoint()).rejects.toThrow(/classify/);
    await expect(driver.verifyDeletion()).rejects.toThrow(/checkpoint required/);
  });
});

describe("CoupangWingDeletionDriver.clearHighlight — the clear is VERIFIED, not assumed", () => {
  it("reports TRUE only when the page is confirmed free of the checkpoint panel", async () => {
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }), {
      checkpointPaintedFn: async () => false, // panel gone
    });
    await expect(driver.clearHighlight()).resolves.toBe(true);
  });

  it("reports FALSE when the panel is STILL mounted after the removal attempt", async () => {
    // The failure this closes: both removals swallow their errors, so the clear could only ever be reported as
    // succeeding. If the SPA re-rendered the overlay host away, the irreversible-warning panel stays on screen
    // while the run prints `checkpointCleared: true` — a false assurance on a destructive surface.
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }), {
      checkpointPaintedFn: async () => true, // still there
    });
    await expect(driver.clearHighlight()).resolves.toBe(false);
  });

  it("an unreadable page reports NOT cleared — it never claims success it cannot see", async () => {
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }), {
      checkpointPaintedFn: async () => {
        throw new Error("Target page, context or browser has been closed");
      },
    });
    await expect(driver.clearHighlight()).resolves.toBe(false);
  });

  it("clearing does NOT reset the phase — removing the checkpoint's pixels cannot unwind the invariant", async () => {
    const page = new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" });
    const driver = makeDriver(page);
    await driver.classifyAlreadyIssued();
    await driver.highlightDeleteCheckpoint();
    expect(driver.currentPhase()).toBe("highlighted");
    await driver.clearHighlight();
    expect(driver.currentPhase()).toBe("highlighted");
    // …so the operator-action step stays reachable after the guidance is retired, exactly as the run needs.
    page.census = WING_HOME;
    await expect(driver.verifyDeletion()).resolves.toMatchObject({ deleted: true });
  });
});

describe("삭제 calibration evidence — WITHDRAWN, because the apparatus could not support the claim", () => {
  it("INTENT MARKER — the calibration is currently WITHDRAWN (this is the ONE test a re-landing turns red)", () => {
    // Deliberately the only assertion on the constant's value, in the direction that now matters. Restoring the
    // flag makes this the confirmation prompt; it may be updated only in a commit that also carries a fresh live
    // measurement. Nothing else in the suite needs touching — every other test states its own calibration or
    // branches on the constant.
    expect(WING_DELETION_SELECTORS_CALIBRATED).toBe(false);
  });

  it("is APPARATUS_UNSOUND — not refuted, and not merely pending", () => {
    // The three states are not interchangeable. PENDING would say nobody looked; REFUTED would say someone
    // looked and disproved it. Someone looked, and we no longer know what they saw — which is the state most
    // likely to be rounded up to "probably fine", on the one path that is irreversible.
    const e = WING_DELETION_CALIBRATION_EVIDENCE;
    expect(e.status).toBe("LIVE_DOM_CALIBRATION_APPARATUS_UNSOUND");
    expect(e.status).not.toBe("LIVE_DOM_CALIBRATION_REFUTED");
    expect(e.status).not.toBe("LIVE_DOM_CALIBRATION_PENDING");
    expect(e.pageCategory).toBe("open_api_issuance");
    expect(e.capturedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.withdrawnOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("records WHY the count is unsound: it predates the visibility filter, and says so with both commits", () => {
    // This is the load-bearing assertion of the withdrawal. `matchCount: 1` was really returned — by the locator
    // version that, on the 발급 target, reported a confident unique match against a node that does not render.
    // The two commits are what make that checkable rather than asserted.
    const e = WING_DELETION_CALIBRATION_EVIDENCE;
    expect(e.withdrawnObservation).toEqual({ matchCount: 1, visibilityFiltered: false });
    expect(e.gitSha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(e.visibilityFilterAddedIn).toBe("a3ef479e");
    expect(e.gitSha).not.toBe(e.visibilityFilterAddedIn);
  });

  it("keeps the spec UNCHANGED — a withdrawal is not a licence to guess a new selector", () => {
    // The capture is unsupported, not disproved. Editing the spec now would mean the eventual re-measurement
    // measures something nobody ever observed, and would destroy the only clean comparison available.
    expect(WING_DELETION_LABELS.delete).toEqual({ candidateQuery: "button,a,span,div", exactText: "삭제" });
    expect(WING_DELETION_CALIBRATION_EVIDENCE.label).toBe(WING_DELETION_LABELS.delete.exactText);
  });

  it("names a LIVE measurement as the only way back, and does not claim a press ever happened", () => {
    expect(WING_DELETION_CALIBRATION_EVIDENCE.reconfirmationRequires).toBe(
      "READ_ONLY_PROBE_VISIBLE_UNIQUE_MATCH_WITH_MEASURED_TAG",
    );
    expect(WING_DELETION_CALIBRATION_EVIDENCE.deletionOutcome).toBe("NEVER_PERFORMED");
  });

  it("the evidence is HONEST about what one capture cannot show", () => {
    // A single capture cannot demonstrate cross-run signature stability, so the record must not claim it — and it
    // must declare the signature is evidence, not a runtime anchor. Doubly so now: the signature is of whatever
    // the unfiltered locator matched.
    expect(WING_DELETION_CALIBRATION_EVIDENCE.captureCount).toBe(1);
    expect(WING_DELETION_CALIBRATION_EVIDENCE.signatureStability).toBe("SINGLE_CAPTURE_NOT_ESTABLISHED");
    expect(WING_DELETION_CALIBRATION_EVIDENCE.signatureRole).toBe("EVIDENCE_ONLY");
  });

  it("the recorded sig16 is an OPAQUE 16-hex token — no selector, value, URL, or PII in the provenance", () => {
    expect(WING_DELETION_CALIBRATION_EVIDENCE.withdrawnSig16).toMatch(/^[0-9a-f]{16}$/);
    const serialized = JSON.stringify(WING_DELETION_CALIBRATION_EVIDENCE);
    for (const forbidden of ["coupang.com", "http", "://", "Access Key", "Secret", "업체코드", "vendor", "querySelector"]) {
      expect(serialized, `provenance must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});
