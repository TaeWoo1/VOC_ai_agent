/**
 * Behavioral test for `CoupangWingDeletionDriver`, driven over a FAKE page — no browser, no WING.
 *
 * Locks the destructive-walk invariants: (a) the delete target is measured value-free (0 / 1 / many, sig only on a
 * unique match); (b) it classifies only the ALREADY-ISSUED page as actionable; (c) it FAILS CLOSED on highlight
 * whenever the delete selector calibration is withdrawn; (d) the CHECKPOINT-FIRST invariant — the operator-action
 * step (`verifyDeletion`) is unreachable until the irreversible-warning checkpoint has been shown; and (e) the
 * driver reads NO field value (the fake page exposes ONLY `evaluate` / `url` / `on`).
 *
 * Since the 삭제 selector is live-calibrated, the DEFAULT driver (no `calibrated` option) is the production shape,
 * so the tests below exercise the real default rather than a test-only override.
 */
import { describe, expect, it } from "vitest";
import { CoupangWingDeletionDriver } from "../../../src/action-window/coupang-wing-deletion-driver";
import {
  WING_DELETION_CALIBRATION_EVIDENCE,
  WING_DELETION_SELECTORS_CALIBRATED,
} from "../../../src/action-window/coupang-wing-issuance-driver";
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

function makeDriver(page: FakePage, opts: Record<string, unknown> = {}): CoupangWingDeletionDriver {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CoupangWingDeletionDriver(page as any, {
    locatorSettleMs: 0,
    verifyPollMs: 0,
    mountOverlayFn: async () => undefined,
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

  it("requires classifying the already-issued page before highlighting (DEFAULT calibration)", async () => {
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }));
    await expect(driver.highlightDeleteCheckpoint()).rejects.toThrow(/classify/);
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
    // The production default now reaches this path — the whole point of the calibration landing.
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

describe("삭제 calibration evidence — the flip is backed by a real live capture, and states its limits", () => {
  it("the calibrated flag is TRUE and carries matching live provenance", () => {
    expect(WING_DELETION_SELECTORS_CALIBRATED).toBe(true);
    const e = WING_DELETION_CALIBRATION_EVIDENCE;
    expect(e.status).toBe("LIVE_DOM_CALIBRATION_CONFIRMED");
    expect(e.matchCount).toBe(1);
    expect(e.canHighlight).toBe(true);
    expect(e.pageCategory).toBe("open_api_issuance");
    expect(e.gitSha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(e.capturedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the evidence is HONEST about what one capture cannot show", () => {
    // A single capture cannot demonstrate cross-run signature stability, so the record must not claim it — and it
    // must declare the signature is evidence, not a runtime anchor.
    expect(WING_DELETION_CALIBRATION_EVIDENCE.captureCount).toBe(1);
    expect(WING_DELETION_CALIBRATION_EVIDENCE.signatureStability).toBe("SINGLE_CAPTURE_NOT_ESTABLISHED");
    expect(WING_DELETION_CALIBRATION_EVIDENCE.signatureRole).toBe("EVIDENCE_ONLY");
  });

  it("the recorded sig16 is an OPAQUE 16-hex token — no selector, value, URL, or PII in the provenance", () => {
    expect(WING_DELETION_CALIBRATION_EVIDENCE.sig16).toMatch(/^[0-9a-f]{16}$/);
    const serialized = JSON.stringify(WING_DELETION_CALIBRATION_EVIDENCE);
    for (const forbidden of ["coupang.com", "http", "://", "Access Key", "Secret", "업체코드", "vendor", "querySelector"]) {
      expect(serialized, `provenance must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});
