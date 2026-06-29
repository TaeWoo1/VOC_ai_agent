import { describe, expect, it } from "vitest";
import {
  candidateActionable,
  candidateEnabled,
  candidateRendered,
  type ExportCandidateVisibility,
  summarizeExportCandidateVisibility,
} from "../../src/esm/esm-export-visibility";

/** A fully visible + enabled candidate; individual cases override fields as needed. */
function candidate(overrides: Partial<ExportCandidateVisibility> = {}): ExportCandidateVisibility {
  return {
    offsetParentPresent: true,
    clientRectsPresent: true,
    boundingBoxNonZero: true,
    displayNotNone: true,
    visibilityNotHidden: true,
    notDisabled: true,
    notAriaDisabled: true,
    ...overrides,
  };
}

describe("candidateRendered — robust cross-check beyond offsetParent", () => {
  it("a fully laid-out, non-hidden candidate is rendered", () => {
    expect(candidateRendered(candidate())).toBe(true);
  });

  it("PORTALED/FIXED: offsetParent null but client-rects/box present → still rendered", () => {
    // The first live ambiguity: offsetParent === null wrongly read as hidden. The
    // robust OR (client rects OR non-zero box) now recognizes it as visible.
    const portaled = candidate({ offsetParentPresent: false, clientRectsPresent: true, boundingBoxNonZero: true });
    expect(candidateRendered(portaled)).toBe(true);
  });

  it("display:none is NOT rendered, even if a stale box lingers", () => {
    expect(candidateRendered(candidate({ displayNotNone: false }))).toBe(false);
  });

  it("visibility:hidden / collapse is NOT rendered", () => {
    expect(candidateRendered(candidate({ visibilityNotHidden: false }))).toBe(false);
  });

  it("zero-box AND no offsetParent AND no client-rects → NOT rendered", () => {
    const hidden = candidate({
      offsetParentPresent: false,
      clientRectsPresent: false,
      boundingBoxNonZero: false,
    });
    expect(candidateRendered(hidden)).toBe(false);
  });
});

describe("candidateEnabled / candidateActionable", () => {
  it("disabled control is not enabled, not actionable", () => {
    const c = candidate({ notDisabled: false });
    expect(candidateEnabled(c)).toBe(false);
    expect(candidateActionable(c)).toBe(false);
  });

  it("aria-disabled control is not enabled, not actionable", () => {
    const c = candidate({ notAriaDisabled: false });
    expect(candidateEnabled(c)).toBe(false);
    expect(candidateActionable(c)).toBe(false);
  });

  it("rendered AND enabled → actionable", () => {
    expect(candidateActionable(candidate())).toBe(true);
  });

  it("ENABLED-BUT-HIDDEN (the live ambiguity): enabled true, rendered false → NOT actionable", () => {
    // Reproduces the first live run: enabled candidates exist, but none render, so
    // hasActionable must be false (Gate 3 stays unjustified).
    const enabledHidden = candidate({
      offsetParentPresent: false,
      clientRectsPresent: false,
      boundingBoxNonZero: false,
    });
    expect(candidateEnabled(enabledHidden)).toBe(true);
    expect(candidateRendered(enabledHidden)).toBe(false);
    expect(candidateActionable(enabledHidden)).toBe(false);
  });
});

describe("summarizeExportCandidateVisibility — sanitized counts", () => {
  it("counts total / visible / enabled / actionable independently", () => {
    const set: ExportCandidateVisibility[] = [
      candidate(), // visible + enabled + actionable
      candidate({ offsetParentPresent: false, clientRectsPresent: false, boundingBoxNonZero: false }), // enabled, not rendered
      candidate({ notDisabled: false }), // rendered (so visible) but disabled → not actionable
      candidate({ offsetParentPresent: false, clientRectsPresent: true, boundingBoxNonZero: true }), // portaled → rendered + actionable
    ];
    // visible counts RENDERED controls (incl. the disabled one); actionable = rendered AND enabled.
    expect(summarizeExportCandidateVisibility(set)).toEqual({ total: 4, visible: 3, enabled: 3, actionable: 2 });
  });

  it("reproduces the first live observation: enabled>0, visible=0, actionable=0", () => {
    const enabledButHidden = Array.from({ length: 2 }, () =>
      candidate({ offsetParentPresent: false, clientRectsPresent: false, boundingBoxNonZero: false }),
    );
    expect(summarizeExportCandidateVisibility(enabledButHidden)).toEqual({
      total: 2,
      visible: 0,
      enabled: 2,
      actionable: 0,
    });
  });

  it("after hydration the SAME control reads visible + actionable", () => {
    // Post-hydration marker: offsetParent now present, box laid out.
    const hydrated = [candidate({ offsetParentPresent: true, boundingBoxNonZero: true })];
    expect(summarizeExportCandidateVisibility(hydrated)).toEqual({ total: 1, visible: 1, enabled: 1, actionable: 1 });
  });

  it("empty set → all zero", () => {
    expect(summarizeExportCandidateVisibility([])).toEqual({ total: 0, visible: 0, enabled: 0, actionable: 0 });
  });

  it("descriptors carry only booleans — the summary never contains text", () => {
    const serialized = JSON.stringify(summarizeExportCandidateVisibility([candidate()]));
    // No DOM text can reach here: descriptors are booleans by construction.
    expect(/[가-힣]/.test(serialized)).toBe(false);
    expect(serialized).toBe('{"total":1,"visible":1,"enabled":1,"actionable":1}');
  });
});
