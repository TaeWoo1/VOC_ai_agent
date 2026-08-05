/**
 * Pure core of API-center VISUAL RECON (`visual-recon.ts`): the fail-closed redaction verdict, the
 * screenshot gate, the sanitized-summary no-leak contract, and the selector-adoption gate. All executed
 * over plain inputs — no browser, no screenshot.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateSelectorCandidate,
  mayScreenshot,
  REDACTION_CATEGORIES,
  sanitizeVisualSummary,
  verifyRedaction,
  VISUAL_RECON_SCREENS,
  resolveVisualReconScope,
  isCanonicalVisualReconSubset,
  type RawRedactionReport,
  type RawVisualControl,
  type RawVisualSummary,
  type RedactionCounts,
  type SelectorCandidate,
} from "../../../src/action-window/api-issuance-calibration/visual-recon";

function zero(): RedactionCounts {
  return { form_field: 0, password: 0, readonly_or_code: 0, credential_area: 0, copy_linked: 0, identity_text: 0, chrome_region: 0 };
}
function counts(partial: Partial<RedactionCounts>): RedactionCounts {
  return { ...zero(), ...partial };
}
function report(over: Partial<RawRedactionReport>): RawRedactionReport {
  return { bodyPresent: true, overlayCount: 0, integrityOk: true, detected: zero(), covered: zero(), ...over };
}

describe("verifyRedaction — fail-closed screenshot gate", () => {
  it("PASSES when every detected sensitive element is covered and overlays are intact", () => {
    const r = report({ overlayCount: 5, detected: counts({ form_field: 3, chrome_region: 2 }), covered: counts({ form_field: 3, chrome_region: 2 }) });
    const v = verifyRedaction([r]);
    expect(v.status).toBe("pass");
    expect(mayScreenshot(v)).toBe(true);
    expect(v.totalDetected).toBe(5);
    expect(v.totalCovered).toBe(5);
  });

  it("PASSES a clean, empty-but-bodied page (nothing sensitive, nothing to cover)", () => {
    const v = verifyRedaction([report({ bodyPresent: true })]);
    expect(v.status).toBe("pass");
    expect(mayScreenshot(v)).toBe(true);
  });

  it("HALTS when a detected sensitive element is NOT covered (per-category shortfall)", () => {
    const r = report({ overlayCount: 2, detected: counts({ form_field: 3 }), covered: counts({ form_field: 2 }) });
    const v = verifyRedaction([r]);
    expect(v.status).toBe("halt");
    expect(v.reasons).toContain("UNCOVERED_SENSITIVE");
    expect(mayScreenshot(v)).toBe(false);
  });

  it("HALTS when one category's surplus would otherwise mask another's shortfall", () => {
    // Aggregate detected(4)==covered(4), but per-category chrome_region is short by one while form_field over-counts.
    const r = report({ overlayCount: 4, detected: counts({ form_field: 2, chrome_region: 2 }), covered: counts({ form_field: 3, chrome_region: 1 }) });
    const v = verifyRedaction([r]);
    expect(v.status).toBe("halt");
    // form_field covered>detected is malformed; chrome_region covered<detected is uncovered — both are HALTs.
    expect(v.reasons).toEqual(expect.arrayContaining(["MALFORMED_REPORT", "UNCOVERED_SENSITIVE"]));
  });

  it("HALTS when overlay integrity failed even if counts balance", () => {
    const r = report({ overlayCount: 1, integrityOk: false, detected: counts({ form_field: 1 }), covered: counts({ form_field: 1 }) });
    const v = verifyRedaction([r]);
    expect(v.status).toBe("halt");
    expect(v.reasons).toContain("OVERLAY_INTEGRITY_FAILED");
  });

  it("HALTS when sensitive elements were detected but zero overlays were drawn", () => {
    const r = report({ overlayCount: 0, detected: counts({ form_field: 2 }), covered: counts({ form_field: 2 }) });
    const v = verifyRedaction([r]);
    expect(v.status).toBe("halt");
    expect(v.reasons).toContain("NO_OVERLAY_WHEN_SENSITIVE");
  });

  it("HALTS on an empty report list (nothing was inspected)", () => {
    const v = verifyRedaction([]);
    expect(v.status).toBe("halt");
    expect(v.reasons).toContain("NO_FRAME_WITH_BODY");
  });

  it("HALTS when no frame had a body to inspect", () => {
    const v = verifyRedaction([report({ bodyPresent: false })]);
    expect(v.status).toBe("halt");
    expect(v.reasons).toContain("NO_FRAME_WITH_BODY");
  });

  it("HALTS on a malformed report (non-integer / missing count, or covered>detected)", () => {
    const bad = { bodyPresent: true, overlayCount: 1, integrityOk: true, detected: { form_field: 1.5 } as unknown as RedactionCounts, covered: zero() } as RawRedactionReport;
    expect(verifyRedaction([bad]).status).toBe("halt");
    const negative = report({ overlayCount: 1, detected: counts({ form_field: 2 }), covered: counts({ form_field: 3 }) });
    expect(verifyRedaction([negative]).reasons).toContain("MALFORMED_REPORT");
  });

  it("aggregates across frames — a child frame's uncovered element HALTS the whole page", () => {
    const top = report({ overlayCount: 3, detected: counts({ form_field: 3 }), covered: counts({ form_field: 3 }) });
    const child = report({ overlayCount: 0, detected: counts({ identity_text: 1 }), covered: counts({ identity_text: 0 }) });
    const v = verifyRedaction([top, child]);
    expect(v.status).toBe("halt");
    expect(v.framesInspected).toBe(2);
  });
});

/* ────────────────────────────── sanitized summary — no-leak ────────────────────────────── */

const SENSITIVE_STRINGS = [
  "seller@example.com", // email
  "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d", // uuid app id
  "sk_live_ABCDEF0123456789abcdef", // secret-like token
  "48213307", // numeric store id
];

function controlWithSensitiveAttrs(): RawVisualControl {
  return {
    tagName: "button",
    role: "button",
    inputType: undefined,
    ancestryTags: ["div", "section", "form"],
    siblingIndex: 1,
    siblingCount: 3,
    boundingBox: { x: 100, y: 40, w: 120, h: 32 },
    viewport: { w: 1280, h: 800 },
    stableAttributes: [
      { name: "id", value: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d" }, // sensitive → must NOT flip hasStableId
      { name: "aria-label", value: "seller@example.com" }, // sensitive → must NOT flip hasStableTestAttr
      { name: "data-testid", value: "create-app" }, // safe → hasStableTestAttr true
    ],
    matchCount: 1,
  };
}

function rawSummary(controls: RawVisualControl[]): RawVisualSummary {
  return {
    controls,
    census: { passwordFieldPresent: false, submitAffordancePresent: true, formCount: 1, editableTextInputCount: 2, readonlyFieldCount: 0, listLikeContainerCount: 4 },
  };
}

describe("sanitizeVisualSummary — sanitized, no raw content leaks", () => {
  const reports = [report({ overlayCount: 3, detected: counts({ form_field: 3 }), covered: counts({ form_field: 3 }) })];
  const verdict = verifyRedaction(reports);
  const summary = sanitizeVisualSummary({
    screen: "app_detail",
    urlCategory: "api_center_host",
    raw: rawSummary([controlWithSensitiveAttrs()]),
    reports,
    verdict,
    screenshotTaken: true,
    viewport: { w: 1280, h: 800 },
  });
  const json = JSON.stringify(summary);

  it("no sensitive attribute value appears anywhere in the sanitized output", () => {
    for (const s of SENSITIVE_STRINGS) expect(json.includes(s)).toBe(false);
  });

  it("a sensitive-looking id/aria-label does NOT flip the presence booleans; a safe test attr does", () => {
    const c = summary.controls[0]!;
    expect(c.hasStableId).toBe(false); // the id value was a UUID → screened out
    expect(c.hasStableTestAttr).toBe(true); // data-testid=create-app is safe → present
  });

  it("controls are closed-vocab + bucketed, never a raw selector", () => {
    const c = summary.controls[0]!;
    expect(c.tagName).toBe("button");
    expect(c.role).toBe("button");
    expect(c.resolution).toBe("resolved");
    expect(c).not.toHaveProperty("selector");
    expect(c).not.toHaveProperty("stableAttributes");
    expect(typeof c.structuralSignature).toBe("string");
  });

  it("echoes only integer redaction counts, one entry per category", () => {
    expect(summary.redaction.categories.map((x) => x.category).sort()).toEqual([...REDACTION_CATEGORIES].sort());
    for (const cat of summary.redaction.categories) {
      expect(Number.isInteger(cat.detected)).toBe(true);
      expect(Number.isInteger(cat.covered)).toBe(true);
    }
  });

  it("records screenshot.taken ONLY when the verdict actually passed (defence in depth)", () => {
    expect(summary.screenshot.taken).toBe(true);
    // Same raw inputs but a HALT verdict → taken must be forced false even if the caller claims true.
    const haltReports = [report({ overlayCount: 0, detected: counts({ form_field: 1 }), covered: counts({ form_field: 0 }) })];
    const halted = sanitizeVisualSummary({
      screen: "app_detail",
      urlCategory: "api_center_host",
      raw: rawSummary([controlWithSensitiveAttrs()]),
      reports: haltReports,
      verdict: verifyRedaction(haltReports),
      screenshotTaken: true, // caller lies
      viewport: { w: 1280, h: 800 },
    });
    expect(halted.screenshot.taken).toBe(false);
  });

  it("refuses to classify an off-host page (page category unknown)", () => {
    const off = sanitizeVisualSummary({
      screen: "app_list",
      urlCategory: "other_host",
      raw: rawSummary([]),
      reports,
      verdict,
      screenshotTaken: false,
      viewport: { w: 1280, h: 800 },
    });
    expect(off.pageCategory).toBe("unknown");
  });
});

/* ────────────────────────────── selector adoption gate ────────────────────────────── */

function candidate(over: Partial<SelectorCandidate>): SelectorCandidate {
  return {
    screen: "app_list",
    selector: 'button[data-testid="create-app"]',
    matchCount: 1,
    screenshotTargetConfirmed: true,
    dependsOnAccountOrCredential: false,
    positionOnly: false,
    usesTextMatch: false,
    usesFixedLabelTextOnly: true,
    ...over,
  };
}

describe("evaluateSelectorCandidate — the five adoption conditions", () => {
  it("adopts a unique, confirmed, credential-free, structural selector", () => {
    expect(evaluateSelectorCandidate(candidate({})).adoptable).toBe(true);
  });

  it("rejects when the screenshot target was not confirmed", () => {
    expect(evaluateSelectorCandidate(candidate({ screenshotTargetConfirmed: false })).reasons).toContain("SCREENSHOT_TARGET_UNCONFIRMED");
  });

  it("rejects a non-unique selector (matchCount !== 1)", () => {
    expect(evaluateSelectorCandidate(candidate({ matchCount: 3 })).reasons).toContain("NOT_UNIQUE");
    expect(evaluateSelectorCandidate(candidate({ matchCount: 0 })).reasons).toContain("NOT_UNIQUE");
  });

  it("rejects a selector that depends on an account/credential value", () => {
    expect(evaluateSelectorCandidate(candidate({ dependsOnAccountOrCredential: true })).reasons).toContain("DEPENDS_ON_ACCOUNT_OR_CREDENTIAL");
  });

  it("rejects a position-only selector", () => {
    expect(evaluateSelectorCandidate(candidate({ positionOnly: true })).reasons).toContain("POSITION_ONLY");
  });

  it("rejects a text selector that is not a fixed UI label", () => {
    expect(evaluateSelectorCandidate(candidate({ usesTextMatch: true, usesFixedLabelTextOnly: false })).reasons).toContain("TEXT_SELECTOR_NOT_FIXED_LABEL");
  });

  it("adopts a text selector that uses only a fixed UI label", () => {
    expect(evaluateSelectorCandidate(candidate({ selector: 'button:has-text("애플리케이션 등록")', usesTextMatch: true, usesFixedLabelTextOnly: true })).adoptable).toBe(true);
  });

  it("rejects a sensitive-looking selector string", () => {
    expect(evaluateSelectorCandidate(candidate({ selector: 'input[value="1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d"]' })).reasons).toContain("SENSITIVE_SELECTOR");
    expect(evaluateSelectorCandidate(candidate({ selector: "" })).reasons).toContain("SENSITIVE_SELECTOR");
  });

  it("rejects targeting the credential VALUE on the credentials screen", () => {
    const r = evaluateSelectorCandidate(candidate({ screen: "credentials", selector: 'input[name="clientSecret"]' }));
    expect(r.reasons).toContain("CREDENTIAL_VALUE_TARGET");
    expect(r.adoptable).toBe(false);
  });

  it("allows a credential-SECTION label control on the credentials screen", () => {
    expect(evaluateSelectorCandidate(candidate({ screen: "credentials", selector: 'section[data-testid="credential-section"] button' })).adoptable).toBe(true);
  });
});

describe("VISUAL_RECON_SCREENS", () => {
  it("covers the four onboarding screens in order", () => {
    expect(VISUAL_RECON_SCREENS).toEqual(["app_list", "app_detail", "api_group", "credentials"]);
  });
});

describe("resolveVisualReconScope — fail-closed per-run capture scope", () => {
  it("absent / empty / whitespace ⇒ the full fixed set (backward-compatible)", () => {
    for (const raw of [undefined, null, "", "   ", " , "]) {
      const r = resolveVisualReconScope(raw);
      expect(r.ok, String(raw)).toBe(true);
      if (r.ok) expect(r.screens).toEqual([...VISUAL_RECON_SCREENS]);
    }
  });

  it("narrows to a canonical subset (app_list + app_detail), regardless of input order / spacing / dupes", () => {
    for (const raw of ["app_list,app_detail", "app_detail, app_list", " app_list , app_detail , app_list "]) {
      const r = resolveVisualReconScope(raw);
      expect(r.ok, raw).toBe(true);
      if (r.ok) expect(r.screens).toEqual(["app_list", "app_detail"]); // canonical registry order, de-duplicated
    }
  });

  it("fails closed on ANY unknown screen (never silently drops, never over-captures)", () => {
    const r = resolveVisualReconScope("app_list,api_grp");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("api_grp");
  });

  it("a single-screen scope is allowed", () => {
    const r = resolveVisualReconScope("app_list");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.screens).toEqual(["app_list"]);
  });
});

describe("isCanonicalVisualReconSubset", () => {
  it("accepts a non-empty canonical-ordered subset, rejects empty / re-ordered / unknown / duplicate", () => {
    expect(isCanonicalVisualReconSubset(["app_list", "app_detail"])).toBe(true);
    expect(isCanonicalVisualReconSubset([...VISUAL_RECON_SCREENS])).toBe(true);
    expect(isCanonicalVisualReconSubset([])).toBe(false);
    expect(isCanonicalVisualReconSubset(["app_detail", "app_list"])).toBe(false); // not canonical order
    expect(isCanonicalVisualReconSubset(["app_list", "nope"])).toBe(false);
    expect(isCanonicalVisualReconSubset(["app_list", "app_list"])).toBe(false); // duplicate
  });
});
