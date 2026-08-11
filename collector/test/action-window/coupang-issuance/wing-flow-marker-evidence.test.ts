import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WING_FLOW_SCREEN_MARKER_EVIDENCE,
  WING_KEY_CREATION_CONTROL_ID,
  WING_KEY_CREATION_SELECTOR_CALIBRATED,
  WING_PURPOSE_SCREEN_MARKER_ID,
  WING_PURPOSE_SCREEN_MARKER_MEASURED,
  WING_PURPOSE_SCREEN_MARKER_SPEC,
  WING_TERMS_SCREEN_MARKERS_MEASURED,
  WING_TERMS_SCREEN_MARKER_IDS,
  WING_TERMS_SCREEN_MARKER_SPECS,
} from "../../../src/action-window/coupang-wing-label-recon";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRV = readFileSync(resolve(HERE, "../../../src/action-window/coupang-wing-issuance-driver.ts"), "utf8");

/**
 * The flags this repository flips only on a recorded reading. `WING_ISSUE_SELECTOR_CALIBRATED` was once set
 * from a plausible fix rather than a measurement and had to be publicly withdrawn; these tests exist so the
 * same move is not available a second time.
 */
describe("the flow-screen markers were MEASURED, and the record says which reading", () => {
  it("promotes both screen markers, and each promotion has evidence behind it", () => {
    expect(WING_PURPOSE_SCREEN_MARKER_MEASURED).toBe(true);
    expect(WING_TERMS_SCREEN_MARKERS_MEASURED).toBe(true);
    const ids = WING_FLOW_SCREEN_MARKER_EVIDENCE.readings.map((r) => r.id);
    expect(ids).toContain(WING_PURPOSE_SCREEN_MARKER_ID);
    expect(ids).toContain("stage3.terms.heading");
  });

  it("each promoted marker has a VISIBLE reading with an OBSERVED tag — not a hidden match, not an expected tag", () => {
    // A hidden unique match is what invalidated the 삭제 record, and a tag that was expected rather than
    // observed is what invalidated the 발급 one. Both failures are representable, so both are excluded here.
    for (const id of [WING_PURPOSE_SCREEN_MARKER_ID, "stage3.terms.heading"]) {
      const visible = WING_FLOW_SCREEN_MARKER_EVIDENCE.readings.filter((r) => r.id === id && r.visibleCount >= 1);
      expect(visible.length, `${id} needs a visible reading`).toBeGreaterThan(0);
      for (const r of visible) {
        expect(r.hiddenCount, `${id} visible reading`).toBe(0);
        expect(r.observedTag, `${id} needs a MEASURED tag`).toBeTruthy();
      }
    }
  });

  it("the terms HEADING was read on both screens, so the promotion rests on a transition and not one snapshot", () => {
    const heading = WING_FLOW_SCREEN_MARKER_EVIDENCE.readings.filter((r) => r.id === "stage3.terms.heading");
    expect(heading.map((r) => r.screen).sort()).toEqual(["PURPOSE", "TERMS"]);
    expect(heading.find((r) => r.screen === "PURPOSE")?.visibleCount).toBe(0);
    expect(heading.find((r) => r.screen === "TERMS")?.visibleCount).toBe(1);
  });
});

/**
 * The key-creation control is the one the seller presses to create a key. It is also the one with no evidence,
 * and those two facts together are why it must stay unhighlighted until measured.
 */
describe("the key-creation control is promoted ONLY on a TERMS-screen reading", () => {
  it("its flag is true, and the reading behind it is visible, unique and tagged BY MEASUREMENT", () => {
    expect(WING_KEY_CREATION_SELECTOR_CALIBRATED).toBe(true);
    const onTerms = WING_FLOW_SCREEN_MARKER_EVIDENCE.readings.find(
      (r) => r.id === WING_KEY_CREATION_CONTROL_ID && r.screen === "TERMS",
    );
    expect(onTerms, "promotion needs a reading from the screen the control lives on").toBeTruthy();
    expect(onTerms?.visibleCount).toBe(1);
    expect(onTerms?.hiddenCount).toBe(0);
    expect(onTerms?.observedTag).toBe("BUTTON");
  });

  it("keeps the PURPOSE-screen reading on the record, because it is what made the promotion premature before", () => {
    // Hidden-unique on the wrong screen looked like evidence for a day. Deleting it would make the record
    // read as though the answer had always been obvious.
    const onPurpose = WING_FLOW_SCREEN_MARKER_EVIDENCE.readings.find(
      (r) => r.id === WING_KEY_CREATION_CONTROL_ID && r.screen === "PURPOSE",
    );
    expect(onPurpose?.visibleCount).toBe(0);
    expect(onPurpose?.hiddenCount).toBe(1);
    expect(onPurpose?.observedTag).toBeUndefined();
  });

  it("the spotlight is gated on the FLAG, so withdrawing the calibration removes the ring by itself", () => {
    // The 삭제 record was withdrawn while its target stayed in a hand-written list. Reading the flag at the
    // point of use is what stops a withdrawal from leaving a ring pointing at nothing.
    expect(DRV).toContain('if (target === "issue_final") return WING_KEY_CREATION_SELECTOR_CALIBRATED;');
  });

  it("it stays a TERMS marker, so the next walk reads it where it actually lives", () => {
    expect(WING_TERMS_SCREEN_MARKER_IDS).toContain(WING_KEY_CREATION_CONTROL_ID);
    expect(WING_TERMS_SCREEN_MARKER_SPECS.map((s) => s.id)).toContain(WING_KEY_CREATION_CONTROL_ID);
  });
});

describe("every terms marker is read in one pass", () => {
  it("the screen probe does not return on the first visible marker", () => {
    const fn = DRV.slice(DRV.indexOf("async probeFlowScreen"), DRV.indexOf("private async markerVisible"));
    // Short-circuiting was correct for the VERDICT and wrong for the EVIDENCE: the heading answered first and
    // the key-creation control was never read on the screen it lives on, costing a whole live sitting.
    expect(fn).not.toContain('if (await this.markerVisible(spec)) return "TERMS"');
    expect(fn).toContain("let terms = false");
    expect(fn).toContain('if (terms) return "TERMS"');
  });

  it("the purpose marker is only consulted when no terms marker painted — TERMS still wins a tie", () => {
    const fn = DRV.slice(DRV.indexOf("async probeFlowScreen"), DRV.indexOf("private async markerVisible"));
    expect(fn.indexOf('if (terms) return "TERMS"')).toBeLessThan(fn.indexOf("WING_PURPOSE_SCREEN_MARKER_SPEC"));
  });

  it("the specs come from the recon candidates — the strings are written down once", () => {
    expect(WING_PURPOSE_SCREEN_MARKER_SPEC.id).toBe(WING_PURPOSE_SCREEN_MARKER_ID);
    expect(WING_TERMS_SCREEN_MARKER_SPECS.map((s) => s.id)).toEqual([...WING_TERMS_SCREEN_MARKER_IDS]);
  });
});
