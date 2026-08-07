/**
 * Behavioral test for `CoupangWingDeletionDriver`, driven over a FAKE page — no browser, no WING.
 *
 * Locks the destructive-walk invariants: (a) the delete target is measured value-free (0 / 1 / many, sig only on a
 * unique match); (b) it classifies only the ALREADY-ISSUED page as actionable; (c) it FAILS CLOSED on highlight
 * while the delete selector is uncalibrated; (d) the CHECKPOINT-FIRST invariant — the operator-action step
 * (`verifyDeletion`) is unreachable until the irreversible-warning checkpoint has been shown; and (e) the driver
 * reads NO field value (the fake page exposes ONLY `evaluate` / `url` / `on`).
 */
import { describe, expect, it } from "vitest";
import { CoupangWingDeletionDriver } from "../../../src/action-window/coupang-wing-deletion-driver";
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
  it("REFUSES to highlight while the delete selector is uncalibrated (default)", async () => {
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" })); // calibrated defaults false
    await driver.classifyAlreadyIssued();
    await expect(driver.highlightDeleteCheckpoint()).rejects.toThrow(/CALIBRATION_PENDING|calibrated/);
  });

  it("requires classifying the already-issued page before highlighting (even when calibrated)", async () => {
    const driver = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }), { calibrated: true });
    await expect(driver.highlightDeleteCheckpoint()).rejects.toThrow(/classify/);
  });

  it("the operator-action step (verifyDeletion) is UNREACHABLE without the checkpoint", async () => {
    // Fresh driver → phase "init"; and even after classify → phase "classified"; neither may call verifyDeletion.
    const a = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }), { calibrated: true });
    await expect(a.verifyDeletion()).rejects.toThrow(/checkpoint required/);
    const b = makeDriver(new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" }), { calibrated: true });
    await b.classifyAlreadyIssued();
    await expect(b.verifyDeletion()).rejects.toThrow(/checkpoint required/);
  });

  it("highlights + rests at the checkpoint on a unique match (calibrated), then verifies the deletion value-free", async () => {
    const page = new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" });
    const driver = makeDriver(page, { calibrated: true });
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

  it("a non-unique 삭제 match stays un-highlighted (never rests the checkpoint)", async () => {
    const driver = makeDriver(new FakePage(ISSUED, { count: 3 }), { calibrated: true });
    await driver.classifyAlreadyIssued();
    const hl = await driver.highlightDeleteCheckpoint();
    expect(hl).toEqual({ count: 3 });
    expect(driver.currentPhase()).toBe("classified"); // NOT highlighted
  });

  it("verifyDeletion reports NOT deleted when the already-issued page is still present", async () => {
    const page = new FakePage(ISSUED, { count: 1, sig: "0123456789abcdef" });
    const driver = makeDriver(page, { calibrated: true });
    await driver.classifyAlreadyIssued();
    await driver.highlightDeleteCheckpoint();
    // census stays ISSUED — the key was not deleted.
    const v = await driver.verifyDeletion();
    expect(v.deleted).toBe(false);
    expect(v.pageCategory).toBe("open_api_issuance");
  });
});
